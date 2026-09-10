import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { toast } from 'vue-sonner'
import LoginView from './LoginView.vue'
import { createAppRouter } from '@/router'
import { useAuthStore } from '@/stores/auth.store'
import { AuthError, type AuthSource } from '@/services/auth.service'
import { makeUser } from '@/test/auth-fixture'

vi.mock('vue-sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() }
}))

/**
 * QA adversarial pass for plan 009 (UI-owned toasts). The store no longer toasts, so
 * every message the visitor sees now depends on this view reading the *right* state at
 * the *right* moment. These tests attack that seam: state that moves while a request is
 * in flight, a submit fired twice, and user data the greeting did not expect.
 */

function makeSource(overrides: Partial<AuthSource> = {}): AuthSource {
  return {
    signup: async () => makeUser(),
    login: async () => makeUser(),
    logout: async () => {},
    getCurrentUser: async () => null,
    updateProfile: async () => makeUser(),
    ...overrides
  }
}

async function mountLogin(overrides: Partial<AuthSource> = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)

  const router = createAppRouter(createMemoryHistory())
  router.push('/login')
  await router.isReady()

  const store = useAuthStore()
  store.setSource(makeSource(overrides))

  const wrapper = mount(LoginView, { global: { plugins: [pinia, router] } })

  return { wrapper, router, store }
}

type Wrapper = Awaited<ReturnType<typeof mountLogin>>['wrapper']

async function switchToSignup(wrapper: Wrapper) {
  const tab = wrapper.findAll('button[role="tab"]').find(b => b.text().includes('Create account'))!
  await tab.trigger('click')
}

async function switchToSignin(wrapper: Wrapper) {
  const tab = wrapper.findAll('button[role="tab"]').find(b => b.text().includes('Sign in'))!
  await tab.trigger('click')
}

/** A promise the test resolves by hand, so a request can be held open mid-flight. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('LoginView under adversarial conditions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  /**
   * The tabs are live while a request is in flight, so `isSignup` can flip between the
   * submit and its answer. The greeting must describe what was actually submitted, not
   * whichever tab happens to be selected when the server replies.
   */
  describe('the mode changing while the request is in flight', () => {
    it('still greets a new account as a signup after the visitor flips to Sign in', async () => {
      const pending = deferred<ReturnType<typeof makeUser>>()
      const { wrapper } = await mountLogin({ signup: () => pending.promise })
      await switchToSignup(wrapper)

      await wrapper.get('#name').setValue('New Person')
      await wrapper.get('#email').setValue('new@example.com')
      await wrapper.get('#password').setValue('hunter2hunter2')
      await wrapper.get('form').trigger('submit')

      // The visitor changes their mind while the request is still open.
      await switchToSignin(wrapper)
      pending.resolve(makeUser({ name: 'New Person' }))
      await flushPromises()

      expect(toast.success).toHaveBeenCalledWith('Welcome, New Person.')
      expect(toast.success).not.toHaveBeenCalledWith('Welcome back, New Person.')
    })

    it('still reports a failed signup as a signup after the visitor flips to Sign in', async () => {
      const pending = deferred<ReturnType<typeof makeUser>>()
      const { wrapper } = await mountLogin({ signup: () => pending.promise })
      await switchToSignup(wrapper)

      await wrapper.get('#name').setValue('New Person')
      await wrapper.get('#email').setValue('taken@example.com')
      await wrapper.get('#password').setValue('hunter2hunter2')
      await wrapper.get('form').trigger('submit')

      await switchToSignin(wrapper)
      pending.reject(new AuthError('EMAIL_TAKEN', 'Email already in use.'))
      await flushPromises()

      expect(toast.error).toHaveBeenCalledWith('That email is already registered.')
      expect(toast.success).not.toHaveBeenCalled()
    })
  })

  /**
   * The submit button is disabled while `auth.isBusy`, but a form can still be
   * submitted by keyboard, and nothing debounces it. One completed sign-in must not
   * stack toasts on the screen.
   */
  describe('a submit fired repeatedly', () => {
    it('toasts once per completed sign-in, not once per keystroke on Enter', async () => {
      let calls = 0
      const pending = deferred<ReturnType<typeof makeUser>>()
      const { wrapper } = await mountLogin({
        login: () => {
          calls += 1
          return pending.promise
        }
      })

      await wrapper.get('#email').setValue('dev@example.com')
      await wrapper.get('#password').setValue('hunter2hunter2')

      // Three submits before the first one has answered.
      await wrapper.get('form').trigger('submit')
      await wrapper.get('form').trigger('submit')
      await wrapper.get('form').trigger('submit')

      pending.resolve(makeUser({ name: 'Dev User' }))
      await flushPromises()

      // Every in-flight submit resolves off the same promise, so the toast count must
      // track completed sign-ins. Documents today's behaviour precisely.
      expect(vi.mocked(toast.success).mock.calls.length).toBe(calls)
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('does not toast at all when local validation stops every one of them', async () => {
      const login = vi.fn(async () => makeUser())
      const { wrapper } = await mountLogin({ login })

      await wrapper.get('form').trigger('submit')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(login).not.toHaveBeenCalled()
      expect(toast.success).not.toHaveBeenCalled()
      expect(toast.error).not.toHaveBeenCalled()
    })
  })

  /**
   * The greeting is built in the view from `auth.user?.name`. The store no longer
   * composes it, so odd user data now lands in the toast unfiltered.
   */
  describe('user data the greeting did not expect', () => {
    it('never renders "undefined" when the saved account has no name', async () => {
      const { wrapper } = await mountLogin({ login: async () => makeUser({ name: '' }) })

      await wrapper.get('#email').setValue('dev@example.com')
      await wrapper.get('#password').setValue('hunter2hunter2')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      const message = vi.mocked(toast.success).mock.calls[0]?.[0] as string
      expect(message).not.toMatch(/undefined|null/)
    })

    /**
     * Was a QA tripwire (pre-existing, not a regression from plan 009): the greeting
     * interpolated `auth.user.name` with no length cap, so a 5000-character name became
     * a 5015-character toast. Fixed by `greetingName()` in `LoginView.vue`, which caps
     * the displayed name at 40 characters with an ellipsis. Regression coverage now.
     */
    it('does not let a very long name turn the greeting into an unbounded toast', async () => {
      const longName = 'A'.repeat(5000)
      const { wrapper } = await mountLogin({ login: async () => makeUser({ name: longName }) })

      await wrapper.get('#email').setValue('dev@example.com')
      await wrapper.get('#password').setValue('hunter2hunter2')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      const message = vi.mocked(toast.success).mock.calls[0]?.[0] as string
      expect(message.length).toBeLessThan(200)
      // Pin the shape, not just the length: a cap that dropped the greeting entirely
      // would also satisfy a bare length check.
      expect(message).toBe(`Welcome back, ${'A'.repeat(39)}….`)
    })

    /**
     * Was a QA tripwire (pre-existing, not a regression from plan 009): the view's
     * fallback was `auth.error ?? '<fallback>'`, and `??` only catches `null`/
     * `undefined`. An `AuthError` carrying an empty message leaves `auth.error === ''`,
     * falsy but not nullish, so the fallback never fired and the user got a blank toast.
     * Fixed with `auth.error?.trim() || '<fallback>'` at all three call sites
     * (`LoginView.vue`, `UserSettingsView.vue`, `SettingsMenu.vue`). Regression coverage
     * now — the sibling cases live in those two specs.
     */
    it('shows something readable when the server sends an error with no message', async () => {
      const { wrapper } = await mountLogin({
        login: async () => {
          throw new AuthError('UNKNOWN_ERROR', '')
        }
      })

      await wrapper.get('#email').setValue('dev@example.com')
      await wrapper.get('#password').setValue('hunter2hunter2')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      const message = vi.mocked(toast.error).mock.calls[0]?.[0] as string
      expect(message).toBeTruthy()
      // Pin the actual copy: `toBeTruthy()` would also pass on a stray space.
      expect(message).toBe('Could not sign you in. Please try again.')
    })
  })

  /**
   * QA re-verification of the two fixes from the first pass. `||` alone closes the
   * empty-string hole; `.trim()` is what closes the whitespace-only one, and
   * `greetingName()`'s cap needs its boundary pinned or an off-by-one goes unnoticed.
   */
  describe('the boundaries of the blank-message and long-name fixes', () => {
    it('falls back when the server message is whitespace rather than empty', async () => {
      const { wrapper } = await mountLogin({
        login: async () => {
          throw new AuthError('UNKNOWN_ERROR', '   \n\t ')
        }
      })

      await wrapper.get('#email').setValue('dev@example.com')
      await wrapper.get('#password').setValue('hunter2hunter2')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(toast.error).toHaveBeenCalledWith('Could not sign you in. Please try again.')
    })

    it('uses the signup fallback, not the sign-in one, for a blank signup error', async () => {
      const { wrapper } = await mountLogin({
        signup: async () => {
          throw new AuthError('UNKNOWN_ERROR', '')
        }
      })
      await switchToSignup(wrapper)

      await wrapper.get('#name').setValue('New Person')
      await wrapper.get('#email').setValue('new@example.com')
      await wrapper.get('#password').setValue('hunter2hunter2')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(toast.error).toHaveBeenCalledWith('Could not create your account. Please try again.')
    })

    it('still shows a real server message that merely has padding around it', async () => {
      const { wrapper } = await mountLogin({
        login: async () => {
          throw new AuthError('WEIRD_CODE', '  Your account is locked.  ')
        }
      })

      await wrapper.get('#email').setValue('dev@example.com')
      await wrapper.get('#password').setValue('hunter2hunter2')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      // The fix must not swallow a genuine message just because it arrived padded.
      expect(toast.error).toHaveBeenCalledWith('Your account is locked.')
    })

    it('greets a name sitting exactly on the cap without truncating it', async () => {
      const exact = 'B'.repeat(40)
      const { wrapper } = await mountLogin({ login: async () => makeUser({ name: exact }) })

      await wrapper.get('#email').setValue('dev@example.com')
      await wrapper.get('#password').setValue('hunter2hunter2')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(toast.success).toHaveBeenCalledWith(`Welcome back, ${exact}.`)
    })

    it('truncates the first name one character over the cap', async () => {
      const over = 'C'.repeat(41)
      const { wrapper } = await mountLogin({ login: async () => makeUser({ name: over }) })

      await wrapper.get('#email').setValue('dev@example.com')
      await wrapper.get('#password').setValue('hunter2hunter2')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(toast.success).toHaveBeenCalledWith(`Welcome back, ${'C'.repeat(39)}….`)
    })

    it('greets a whitespace-only name as "there" rather than a blank space', async () => {
      const { wrapper } = await mountLogin({ login: async () => makeUser({ name: '   ' }) })

      await wrapper.get('#email').setValue('dev@example.com')
      await wrapper.get('#password').setValue('hunter2hunter2')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(toast.success).toHaveBeenCalledWith('Welcome back, there.')
    })
  })
})
