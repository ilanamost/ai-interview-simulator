import type { User } from '@/types/user'
import { env } from '@/config/env'
import { API_TOAST } from '@/services/toast-message.service'

/**
 * Auth calls are cheap round-trips (no LLM behind them), so they fail faster than
 * the interview source's 30s budget.
 */
const TIMEOUT_MS = 15000

/** User-safe error carrying a machine-readable code (.rule/error-handling-rules.md). */
export class AuthError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

export interface SignupInput {
  email: string
  name: string
  password: string
}

export interface LoginInput {
  email: string
  password: string
}

/**
 * Partial profile update — send only what changed. `avatarUrl: null` clears the
 * avatar. `currentPassword` is required by the API whenever `password` is present.
 */
export interface UpdateProfileInput {
  name?: string
  email?: string
  avatarUrl?: string | null
  password?: string
  currentPassword?: string
}

/**
 * The contract the auth store talks to. There is one implementation (HTTP) — unlike
 * `InterviewSource` there is no mock stage — but it stays an interface so tests can
 * inject a stub without mocking modules (.rule/coding-rules.md).
 */
export interface AuthSource {
  signup(input: SignupInput): Promise<User>
  login(input: LoginInput): Promise<User>
  logout(): Promise<void>
  /** `null` when nobody is signed in — the normal state for a first-time visitor. */
  getCurrentUser(): Promise<User | null>
  updateProfile(input: UpdateProfileInput): Promise<User>
}

interface ApiErrorBody {
  error?: { code?: string; message?: string }
}

interface UserEnvelope {
  user: User
}

/**
 * Every call carries `credentials: 'include'`, including the public `/auth/*` ones:
 * without it the browser neither stores the `access_token`/`refresh_token` cookies
 * the API sets nor sends them back, and every guarded request 401s. The tokens
 * themselves are HttpOnly — this code never reads or writes one.
 */
async function send(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    return await fetch(url, { ...init, credentials: 'include', signal: controller.signal })
  } catch {
    throw new AuthError('NETWORK_ERROR', API_TOAST.networkUnreachable)
  } finally {
    clearTimeout(timeout)
  }
}

async function toError(response: Response): Promise<AuthError> {
  const body = (await response.json().catch(() => null)) as ApiErrorBody | null
  return new AuthError(
    body?.error?.code ?? 'UNKNOWN_ERROR',
    body?.error?.message ?? API_TOAST.requestRejected
  )
}

function jsonInit(method: string, body?: unknown): RequestInit {
  if (body === undefined) return { method }
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

/**
 * Rotates the session cookies, returning whether the caller may retry.
 *
 * Exported because the interview source needs the same move: the access token lives
 * ~15 minutes while a single interview question routinely takes longer to answer, so
 * any guarded call can meet an expired token through no fault of the user. `false`
 * means the refresh token is gone too and the session is genuinely over — the caller
 * must not try again.
 */
export async function refreshSession(baseUrl: string): Promise<boolean> {
  try {
    const response = await send(`${baseUrl}/api/auth/refresh`, { method: 'POST' })
    return response.ok
  } catch {
    // A dead connection is not a dead session, but it is not a retry either.
    return false
  }
}

export function createHttpAuthSource(baseUrl: string): AuthSource {
  const authUrl = (path: string) => `${baseUrl}/api/auth/${path}`
  const userUrl = `${baseUrl}/api/user`

  /** Public `/auth/*` call: one shot, no refresh dance — there is no session yet. */
  async function requestUser(url: string, init: RequestInit): Promise<User> {
    const response = await send(url, init)
    if (!response.ok) throw await toError(response)

    const { user } = (await response.json()) as UserEnvelope
    return user
  }

  /**
   * The access token lives ~15 minutes while the refresh token lives ~30 days, so a
   * guarded call routinely meets an expired access token. Rotate once via
   * `/auth/refresh` and retry exactly once; a second failure means "signed out".
   * Only `UNAUTHENTICATED` is retried — `INVALID_CREDENTIALS` on a password change
   * is also a 401 and must surface to the user untouched.
   */
  async function requestGuarded(init: RequestInit): Promise<User> {
    const response = await send(userUrl, init)
    if (response.ok) return ((await response.json()) as UserEnvelope).user

    const error = await toError(response)
    if (error.code !== 'UNAUTHENTICATED') throw error

    if (!(await refreshSession(baseUrl))) throw error

    return requestUser(userUrl, init)
  }

  return {
    signup(input) {
      return requestUser(authUrl('signup'), jsonInit('POST', input))
    },

    login(input) {
      return requestUser(authUrl('login'), jsonInit('POST', input))
    },

    async logout() {
      // Idempotent server-side, and the body must be empty — any field is a 400.
      const response = await send(authUrl('logout'), { method: 'POST' })
      if (!response.ok) throw await toError(response)
    },

    async getCurrentUser() {
      try {
        return await requestGuarded({ method: 'GET' })
      } catch (err) {
        // Signed out is the normal answer here, not a failure worth surfacing.
        if (err instanceof AuthError && err.code === 'UNAUTHENTICATED') return null
        throw err
      }
    },

    updateProfile(input) {
      return requestGuarded(jsonInit('PATCH', input))
    }
  }
}

/** The app-wide source. Tests inject their own through `authStore.setSource`. */
export const authSource: AuthSource = createHttpAuthSource(env.apiBaseUrl)
