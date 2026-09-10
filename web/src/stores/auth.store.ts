import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { User } from '@/types/user'
import {
  AuthError,
  authSource,
  type AuthSource,
  type LoginInput,
  type SignupInput,
  type UpdateProfileInput
} from '@/services/auth.service'
import { AUTH_ERROR_BY_CODE, AUTH_TOAST, PROFILE_TOAST } from '@/services/toast-message.service'

/**
 * `checking` — the boot-time `fetchMe()` is in flight
 * `busy`     — a signup/login/logout/update the user is waiting on
 * `ready`    — auth state is settled, signed in or not
 */
export type AuthStatus = 'idle' | 'checking' | 'busy' | 'ready'

/**
 * Widened for lookup. The copy itself lives in `toast-message.service.ts` as an
 * `as const` table, which has no index signature — a code the API invents is `undefined`
 * here and falls through to the next branch, exactly as it did when the table was local.
 */
const messageByCode: Record<string, string | undefined> = AUTH_ERROR_BY_CODE

/**
 * Per-action overrides win, then the shared code map, then the API's own user-safe
 * message, then the caller's fallback. A `VALIDATION_ERROR` has no fixed copy — the
 * server says exactly which field is wrong, so it falls through to `err.message`.
 */
function toUserMessage(
  err: unknown,
  fallback: string,
  overrides: Record<string, string> = {}
): string {
  if (err instanceof AuthError) {
    return overrides[err.code] ?? messageByCode[err.code] ?? err.message ?? fallback
  }
  return fallback
}

export const useAuthStore = defineStore('auth', () => {
  // Swappable so tests can inject a stub rather than mocking the module.
  const source = ref<AuthSource>(authSource)

  const user = ref<User | null>(null)
  const status = ref<AuthStatus>('idle')
  const error = ref<string | null>(null)

  const isAuthenticated = computed(() => user.value !== null)
  const isBusy = computed(() => status.value === 'checking' || status.value === 'busy')

  function setSource(next: AuthSource) {
    source.value = next
  }

  /** Records why the call failed and returns the `false` the caller reports on. */
  function fail(err: unknown, fallback: string, overrides?: Record<string, string>): false {
    error.value = toUserMessage(err, fallback, overrides)
    status.value = 'ready'
    return false
  }

  /**
   * Drops the session locally after the server has already refused it — the cookies
   * are gone or revoked, so there is nothing to log out of. Called when a guarded
   * call comes back `UNAUTHENTICATED` even after a refresh. Idempotent, so several
   * failing calls in flight at once collapse into one sign-out, not a pile of them.
   */
  function expire() {
    if (!user.value) return

    user.value = null
    status.value = 'ready'
    error.value = AUTH_ERROR_BY_CODE.UNAUTHENTICATED
  }

  /**
   * Boot-time "am I signed in?". A signed-out visitor is the normal case, not an
   * error: it resolves to `false` with no toast so the app still mounts and the
   * router can send them to `/login`. Only a broken connection is worth reporting.
   */
  async function fetchMe(): Promise<boolean> {
    status.value = 'checking'
    error.value = null

    try {
      user.value = await source.value.getCurrentUser()
      status.value = 'ready'
      return isAuthenticated.value
    } catch (err) {
      user.value = null
      // Do not block the boot on this — the user lands on /login and can retry there.
      error.value = toUserMessage(err, AUTH_TOAST.checkFailed)
      status.value = 'ready'
      return false
    }
  }

  async function signup(input: SignupInput): Promise<boolean> {
    status.value = 'busy'
    error.value = null

    try {
      user.value = await source.value.signup(input)
      status.value = 'ready'
      return true
    } catch (err) {
      return fail(err, AUTH_TOAST.signupFailed)
    }
  }

  async function login(input: LoginInput): Promise<boolean> {
    status.value = 'busy'
    error.value = null

    try {
      user.value = await source.value.login(input)
      status.value = 'ready'
      return true
    } catch (err) {
      return fail(err, AUTH_TOAST.signinFailed)
    }
  }

  /**
   * Clears the session locally whatever the server says. The user asked to be signed
   * out; leaving them looking signed in because the request failed is the worse
   * outcome, and the cookies are short-lived anyway.
   */
  async function logout(): Promise<boolean> {
    status.value = 'busy'
    error.value = null

    try {
      await source.value.logout()
      user.value = null
      status.value = 'ready'
      return true
    } catch (err) {
      user.value = null
      return fail(err, AUTH_TOAST.logoutFailed)
    }
  }

  async function updateProfile(input: UpdateProfileInput): Promise<boolean> {
    status.value = 'busy'
    error.value = null

    try {
      user.value = await source.value.updateProfile(input)
      status.value = 'ready'
      return true
    } catch (err) {
      // Here a 401 means the current password was wrong, not that the session died.
      return fail(err, PROFILE_TOAST.saveFailed, {
        INVALID_CREDENTIALS: PROFILE_TOAST.currentPasswordWrong
      })
    }
  }

  return {
    user,
    status,
    error,
    isAuthenticated,
    isBusy,
    setSource,
    expire,
    fetchMe,
    signup,
    login,
    logout,
    updateProfile
  }
})
