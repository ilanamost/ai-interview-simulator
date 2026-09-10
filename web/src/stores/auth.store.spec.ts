import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { toast } from 'vue-sonner'
import { useAuthStore } from './auth.store'
import { AuthError, type AuthSource } from '@/services/auth.service'
import { makeUser } from '@/test/auth-fixture'

/**
 * Kept mocked so the "no store-level toasting" tests below can prove the store never
 * reaches for it: telling the user is the view's job, the store only computes the copy.
 */
vi.mock('vue-sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() }
}))

/** Minimal source: every method resolves to the fixture user unless told to fail. */
function makeStubSource(overrides: Partial<AuthSource> = {}): AuthSource {
  return {
    signup: async () => makeUser(),
    login: async () => makeUser(),
    logout: async () => {},
    getCurrentUser: async () => makeUser(),
    updateProfile: async () => makeUser(),
    ...overrides
  }
}

function storeWith(overrides: Partial<AuthSource> = {}) {
  const store = useAuthStore()
  store.setSource(makeStubSource(overrides))
  return store
}

describe('auth store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('starts signed out', () => {
    const store = useAuthStore()

    expect(store.user).toBeNull()
    expect(store.isAuthenticated).toBe(false)
  })

  describe('fetchMe', () => {
    it('adopts the user the server reports', async () => {
      const store = storeWith()

      await store.fetchMe()

      expect(store.isAuthenticated).toBe(true)
      expect(store.user?.email).toBe('dev@example.com')
      expect(store.status).toBe('ready')
    })

    it('resolves to signed out without an error when nobody is signed in', async () => {
      // A first-time visitor is the normal case, not a failure to shout about.
      const store = storeWith({ getCurrentUser: async () => null })

      const result = await store.fetchMe()

      expect(result).toBe(false)
      expect(store.isAuthenticated).toBe(false)
      expect(store.status).toBe('ready')
      expect(store.error).toBeNull()
    })

    it('still settles as signed out when the server is unreachable, so the app can boot', async () => {
      const store = storeWith({
        getCurrentUser: async () => {
          throw new AuthError('NETWORK_ERROR', 'boom')
        }
      })

      await expect(store.fetchMe()).resolves.toBe(false)
      expect(store.isAuthenticated).toBe(false)
      expect(store.status).toBe('ready')
    })
  })

  describe('signup', () => {
    it('signs the new user in', async () => {
      const signup = vi.fn(async () => makeUser({ name: 'New Person' }))
      const store = storeWith({ signup })

      const ok = await store.signup({ email: 'new@example.com', name: 'New Person', password: 'hunter2hunter2' })

      expect(ok).toBe(true)
      expect(store.user?.name).toBe('New Person')
      expect(signup).toHaveBeenCalledWith({
        email: 'new@example.com',
        name: 'New Person',
        password: 'hunter2hunter2'
      })
    })

    it('reports that the email is taken rather than a generic failure', async () => {
      const store = storeWith({
        signup: async () => {
          throw new AuthError('EMAIL_TAKEN', 'Email already in use.')
        }
      })

      const ok = await store.signup({ email: 'taken@example.com', name: 'A', password: 'hunter2hunter2' })

      expect(ok).toBe(false)
      expect(store.isAuthenticated).toBe(false)
      expect(store.error).toBe('That email is already registered.')
    })
  })

  describe('login', () => {
    it('signs an existing user in', async () => {
      const store = storeWith()

      const ok = await store.login({ email: 'dev@example.com', password: 'hunter2hunter2' })

      expect(ok).toBe(true)
      expect(store.isAuthenticated).toBe(true)
    })

    it('reports one message for bad credentials, without hinting which half was wrong', async () => {
      const store = storeWith({
        login: async () => {
          throw new AuthError('INVALID_CREDENTIALS', 'Invalid credentials.')
        }
      })

      const ok = await store.login({ email: 'dev@example.com', password: 'nope' })

      expect(ok).toBe(false)
      expect(store.error).toBe('Email or password is incorrect.')
      expect(store.error).not.toMatch(/email.*not.*found|no such account/i)
    })
  })

  describe('logout', () => {
    it('clears the user', async () => {
      const store = storeWith()
      await store.fetchMe()

      await store.logout()

      expect(store.user).toBeNull()
      expect(store.isAuthenticated).toBe(false)
    })

    it('clears the user locally even when the server call fails', async () => {
      const store = storeWith({
        logout: async () => {
          throw new AuthError('NETWORK_ERROR', 'boom')
        }
      })
      await store.fetchMe()

      const ok = await store.logout()

      expect(ok).toBe(false)
      expect(store.isAuthenticated).toBe(false)
      expect(store.error).toBe('Could not reach the server. Check your connection and try again.')
    })
  })

  describe('expire', () => {
    it('drops the session and says why, without calling the server', async () => {
      const logout = vi.fn()
      const store = storeWith({ logout })
      await store.fetchMe()

      store.expire()

      expect(store.isAuthenticated).toBe(false)
      // The cookies are already gone; there is nothing to log out of.
      expect(logout).not.toHaveBeenCalled()
      expect(store.error).toBe('Your session has expired. Please sign in again.')
    })

    it('acts once even when several failing calls report the expiry at the same time', async () => {
      const store = storeWith()
      await store.fetchMe()

      store.expire()
      // Whatever showed the first message has had it; a repeat must not re-raise it.
      store.error = null
      store.expire()
      store.expire()

      expect(store.error).toBeNull()
    })

    it('does nothing to a visitor who was never signed in', () => {
      const store = storeWith()

      store.expire()

      expect(store.error).toBeNull()
      expect(store.status).toBe('idle')
    })
  })

  describe('updateProfile', () => {
    it('replaces the user with what the server saved', async () => {
      const updateProfile = vi.fn(async () => makeUser({ name: 'Renamed' }))
      const store = storeWith({ updateProfile })
      await store.fetchMe()

      const ok = await store.updateProfile({ name: 'Renamed' })

      expect(ok).toBe(true)
      expect(store.user?.name).toBe('Renamed')
      expect(updateProfile).toHaveBeenCalledWith({ name: 'Renamed' })
    })

    it('reads a 401 here as a wrong current password, not an expired session', async () => {
      const store = storeWith({
        updateProfile: async () => {
          throw new AuthError('INVALID_CREDENTIALS', 'Invalid credentials.')
        }
      })
      await store.fetchMe()

      const ok = await store.updateProfile({ password: 'newpassword', currentPassword: 'wrong' })

      expect(ok).toBe(false)
      expect(store.error).toBe('Your current password is incorrect.')
      // The session survives a rejected password change.
      expect(store.isAuthenticated).toBe(true)
    })

    it('surfaces the server message for a validation error it has no fixed copy for', async () => {
      const store = storeWith({
        updateProfile: async () => {
          throw new AuthError('VALIDATION_ERROR', 'avatarUrl must be a data URL.')
        }
      })

      await store.updateProfile({ avatarUrl: 'http://example.com/a.png' })

      expect(store.error).toBe('avatarUrl must be a data URL.')
    })
  })

  /**
   * Showing the message is the calling view's job (`LoginView`, `UserSettingsView`,
   * `SettingsMenu`), so no action may reach for `vue-sonner` itself — a store that
   * toasts cannot be reused by a screen that wants the error inline instead.
   */
  describe('telling the user', () => {
    it('never toasts, whichever action succeeds', async () => {
      const store = storeWith()

      await store.signup({ email: 'new@example.com', name: 'New', password: 'hunter2hunter2' })
      await store.login({ email: 'dev@example.com', password: 'hunter2hunter2' })
      await store.updateProfile({ name: 'Renamed' })
      await store.logout()

      expect(toast.success).not.toHaveBeenCalled()
      expect(toast.error).not.toHaveBeenCalled()
      expect(toast.info).not.toHaveBeenCalled()
    })

    it('never toasts, whichever action fails', async () => {
      const boom = async () => {
        throw new AuthError('NETWORK_ERROR', 'boom')
      }
      const store = storeWith({
        signup: boom,
        login: boom,
        logout: boom,
        getCurrentUser: boom,
        updateProfile: boom
      })

      await store.fetchMe()
      await store.signup({ email: 'new@example.com', name: 'New', password: 'hunter2hunter2' })
      await store.login({ email: 'dev@example.com', password: 'hunter2hunter2' })
      await store.updateProfile({ name: 'Renamed' })
      await store.logout()

      // The copy is still computed — it is left on `error` for the view to show.
      expect(store.error).toBe('Could not reach the server. Check your connection and try again.')
      expect(toast.error).not.toHaveBeenCalled()
      expect(toast.success).not.toHaveBeenCalled()
    })

    it('never toasts an expired session either', async () => {
      const store = storeWith()
      await store.fetchMe()

      store.expire()

      expect(store.error).toBe('Your session has expired. Please sign in again.')
      expect(toast.error).not.toHaveBeenCalled()
    })
  })
})
