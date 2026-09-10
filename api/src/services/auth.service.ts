import { randomUUID } from 'node:crypto'
import { AppError } from '../utils/app-error.js'
import type { UserRecord, UserRepository } from '../repositories/user.repository.js'
import type { UserSessionRepository } from '../repositories/user-session.repository.js'
import type { PasswordService } from './auth/password.service.js'
import type { AccessTokenPayload, TokenService } from './auth/token.service.js'
import type { User } from '../types/user.js'

export interface AuthServiceDeps {
  userRepository: UserRepository
  sessionRepository: UserSessionRepository
  passwords: PasswordService
  tokens: TokenService
  /** The org every signup lands in. The app is still single-org (ORG_ID). */
  org: string
  /** Injectable for deterministic tests; defaults to crypto.randomUUID. */
  idGenerator?: () => string
  now?: () => Date
}

/** What a route needs to set cookies and answer with the public user. */
export interface AuthResult {
  user: User
  accessToken: string
  refreshToken: string
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

export interface UpdateProfileInput {
  name?: string
  email?: string
  avatarUrl?: string | null
  password?: string
  currentPassword?: string
}

/** Identity resolved from the access-token cookie by require-auth. */
export interface AuthContext {
  userId: string
  org: string
  sessionId: string
}

const INVALID_CREDENTIALS = 'Email or password is incorrect.'
const SESSION_INVALID = 'Your session is no longer valid. Please sign in again.'

/** Strips the hash: this is the only user shape that ever leaves the API. */
function toUser(record: UserRecord): User {
  return {
    id: record.id,
    email: record.email,
    name: record.name,
    avatarUrl: record.avatarUrl
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function createAuthService(deps: AuthServiceDeps) {
  const nextId = deps.idGenerator ?? randomUUID
  const now = deps.now ?? (() => new Date())
  const org = deps.org

  /** Issues a fresh session row plus the token pair that points at it. */
  async function issueSession(record: UserRecord): Promise<AuthResult> {
    const sessionId = nextId()
    const payload: AccessTokenPayload = { userId: record.id, org, sessionId }
    const accessToken = deps.tokens.signAccessToken(payload)
    const refreshToken = deps.tokens.signRefreshToken(payload)

    await deps.sessionRepository.createSession({
      id: sessionId,
      userId: record.id,
      org,
      refreshTokenHash: deps.tokens.hashRefreshToken(refreshToken),
      expiresAt: new Date(now().getTime() + deps.tokens.refreshTtlMs)
    })

    return { user: toUser(record), accessToken, refreshToken }
  }

  async function signup(input: SignupInput): Promise<AuthResult> {
    const email = normalizeEmail(input.email)

    const existing = await deps.userRepository.findByEmail(email, org)
    if (existing) throw AppError.conflict('That email is already registered.', 'EMAIL_TAKEN')

    const record = await deps.userRepository.createUser({
      id: nextId(),
      org,
      email,
      name: input.name.trim(),
      passwordHash: await deps.passwords.hash(input.password)
    })

    return issueSession(record)
  }

  async function login(input: LoginInput): Promise<AuthResult> {
    const record = await deps.userRepository.findByEmail(normalizeEmail(input.email), org)
    // Same code and message whether the email is unknown or the password is wrong,
    // so the response is not an account-existence oracle.
    if (!record) {
      throw AppError.unauthenticated('INVALID_CREDENTIALS', INVALID_CREDENTIALS)
    }

    const matches = await deps.passwords.verify(input.password, record.passwordHash)
    if (!matches) {
      throw AppError.unauthenticated('INVALID_CREDENTIALS', INVALID_CREDENTIALS)
    }

    return issueSession(record)
  }

  /** Idempotent: an absent or unreadable token still logs the caller out cleanly. */
  async function logout(input: { refreshToken?: string; accessToken?: string }): Promise<void> {
    const sessionId = readSessionId(input)
    if (!sessionId) return
    await deps.sessionRepository.revokeSession(sessionId, org)
  }

  function readSessionId(input: { refreshToken?: string; accessToken?: string }): string | null {
    if (input.refreshToken) {
      try {
        return deps.tokens.verifyRefreshToken(input.refreshToken).sessionId
      } catch {
        /* fall through to the access token */
      }
    }
    if (input.accessToken) {
      try {
        return deps.tokens.verifyAccessToken(input.accessToken).sessionId
      } catch {
        return null
      }
    }
    return null
  }

  /**
   * Rotates the token pair: the presented session is revoked and a new one issued,
   * so a stolen refresh token stops working the moment the real user refreshes.
   */
  async function refresh(refreshToken: string | undefined): Promise<AuthResult> {
    if (!refreshToken) throw AppError.unauthenticated('UNAUTHENTICATED', SESSION_INVALID)

    const payload = deps.tokens.verifyRefreshToken(refreshToken)
    if (payload.org !== org) throw AppError.unauthenticated('UNAUTHENTICATED', SESSION_INVALID)

    const session = await deps.sessionRepository.findSession(payload.sessionId, org)
    if (!session || session.revokedAt || session.expiresAt.getTime() <= now().getTime()) {
      throw AppError.unauthenticated('UNAUTHENTICATED', SESSION_INVALID)
    }
    if (session.refreshTokenHash !== deps.tokens.hashRefreshToken(refreshToken)) {
      throw AppError.unauthenticated('UNAUTHENTICATED', SESSION_INVALID)
    }

    const record = await deps.userRepository.findById(payload.userId, org)
    if (!record) throw AppError.unauthenticated('UNAUTHENTICATED', SESSION_INVALID)

    await deps.sessionRepository.revokeSession(session.id, org)
    return issueSession(record)
  }

  /**
   * Confirms the `user_session` row behind an access token is still live.
   *
   * require-auth calls this on every guarded request, which is what makes logout and
   * password-change revocation take effect on the next call rather than whenever the
   * access JWT happens to expire (.rule/security-rules.md: "invalidate sessions/
   * tokens on logout, password change"). Verifying the signature alone would leave a
   * revoked session usable for up to ACCESS_TOKEN_TTL_MIN.
   *
   * Costs one indexed read per guarded request, keyed by the `sid` claim the token
   * already carries.
   */
  async function assertSessionActive(payload: AccessTokenPayload): Promise<void> {
    // Scoped by the token's own org, never the service's configured org: a token
    // minted elsewhere must not find a session row here.
    const session = await deps.sessionRepository.findSession(payload.sessionId, payload.org)
    if (!session || session.revokedAt || session.expiresAt.getTime() <= now().getTime()) {
      throw AppError.unauthenticated('UNAUTHENTICATED', SESSION_INVALID)
    }
    if (session.userId !== payload.userId) {
      throw AppError.unauthenticated('UNAUTHENTICATED', SESSION_INVALID)
    }
  }

  async function getCurrentUser(ctx: AuthContext): Promise<User> {
    const record = await deps.userRepository.findById(ctx.userId, ctx.org)
    if (!record) throw AppError.unauthenticated('UNAUTHENTICATED', SESSION_INVALID)
    return toUser(record)
  }

  async function updateProfile(ctx: AuthContext, patch: UpdateProfileInput): Promise<User> {
    const current = await deps.userRepository.findById(ctx.userId, ctx.org)
    if (!current) throw AppError.unauthenticated('UNAUTHENTICATED', SESSION_INVALID)

    const update: {
      id: string
      org: string
      name?: string
      email?: string
      avatarUrl?: string | null
      passwordHash?: string
    } = { id: current.id, org: ctx.org }

    if (patch.name !== undefined) update.name = patch.name.trim()
    if (patch.avatarUrl !== undefined) update.avatarUrl = patch.avatarUrl

    if (patch.email !== undefined) {
      const email = normalizeEmail(patch.email)
      if (email !== current.email.toLowerCase()) {
        const taken = await deps.userRepository.findByEmail(email, ctx.org)
        if (taken && taken.id !== current.id) {
          throw AppError.conflict('That email is already registered.', 'EMAIL_TAKEN')
        }
      }
      update.email = email
    }

    if (patch.password !== undefined) {
      // Changing a password always re-proves the old one, so a stolen access cookie
      // cannot lock the real owner out of their account.
      const matches = await deps.passwords.verify(patch.currentPassword ?? '', current.passwordHash)
      if (!matches) {
        throw AppError.unauthenticated('INVALID_CREDENTIALS', 'Your current password is incorrect.')
      }
      update.passwordHash = await deps.passwords.hash(patch.password)
    }

    const updated = await deps.userRepository.updateUser(update)
    if (!updated) throw AppError.unauthenticated('UNAUTHENTICATED', SESSION_INVALID)

    if (update.passwordHash) {
      // .rule/security-rules.md: invalidate sessions on password change. The caller's
      // own session survives so they are not signed out of the device they used.
      await deps.sessionRepository.revokeAllForUser(current.id, ctx.org, ctx.sessionId)
    }

    return toUser(updated)
  }

  return {
    signup,
    login,
    logout,
    refresh,
    assertSessionActive,
    getCurrentUser,
    updateProfile
  }
}

export type AuthService = ReturnType<typeof createAuthService>
