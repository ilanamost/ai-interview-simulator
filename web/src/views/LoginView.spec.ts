import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, type Router } from 'vue-router'
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

  return { wrapper, router: router as Router, store }
}

/** The tabs are the only way to reach the create-account fields. */
async function switchToSignup(wrapper: Awaited<ReturnType<typeof mountLogin>>['wrapper']) {
  const tab = wrapper.findAll('button[role="tab"]').find(b => b.text().includes('Create account'))!
  await tab.trigger('click')
}

describe('LoginView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens on sign in, with no name field to fill', async () => {
    const { wrapper } = await mountLogin()

    expect(wrapper.get('h1').text()).toBe('Sign in')
    expect(wrapper.find('#name').exists()).toBe(false)
    expect(wrapper.find('#email').exists()).toBe(true)
    expect(wrapper.find('#password').exists()).toBe(true)
  })

  it('reveals the name field when the visitor switches to creating an account', async () => {
    const { wrapper } = await mountLogin()

    await switchToSignup(wrapper)

    expect(wrapper.get('h1').text()).toBe('Create your account')
    expect(wrapper.find('#name').exists()).toBe(true)
  })

  describe('validation', () => {
    it('will not submit an empty form, and says which fields are missing', async () => {
      const login = vi.fn()
      const { wrapper } = await mountLogin({ login })

      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(login).not.toHaveBeenCalled()
      expect(wrapper.text()).toContain('Enter your email.')
      expect(wrapper.text()).toContain('Enter your password.')
    })

    it('rejects a malformed email before spending a request on it', async () => {
      const login = vi.fn()
      const { wrapper } = await mountLogin({ login })

      await wrapper.get('#email').setValue('not-an-email')
      await wrapper.get('#password').setValue('hunter2hunter2')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(login).not.toHaveBeenCalled()
      expect(wrapper.text()).toContain('Enter a valid email address.')
    })

    it('rejects a too-short password on signup, matching the API minimum', async () => {
      const signup = vi.fn()
      const { wrapper } = await mountLogin({ signup })
      await switchToSignup(wrapper)

      await wrapper.get('#name').setValue('New Person')
      await wrapper.get('#email').setValue('new@example.com')
      await wrapper.get('#password').setValue('short')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(signup).not.toHaveBeenCalled()
      expect(wrapper.text()).toContain('Use at least 8 characters.')
    })

    it('requires a name on signup', async () => {
      const signup = vi.fn()
      const { wrapper } = await mountLogin({ signup })
      await switchToSignup(wrapper)

      await wrapper.get('#email').setValue('new@example.com')
      await wrapper.get('#password').setValue('hunter2hunter2')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(signup).not.toHaveBeenCalled()
      expect(wrapper.text()).toContain('Enter your name.')
    })

    it('accepts a short password when signing in — only the API judges an existing one', async () => {
      const login = vi.fn(async () => makeUser())
      const { wrapper } = await mountLogin({ login })

      await wrapper.get('#email').setValue('dev@example.com')
      await wrapper.get('#password').setValue('short')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(login).toHaveBeenCalled()
    })
  })

  describe('submitting', () => {
    it('signs in and moves to the home page', async () => {
      const login = vi.fn(async () => makeUser())
      const { wrapper, router, store } = await mountLogin({ login })

      await wrapper.get('#email').setValue('  dev@example.com  ')
      await wrapper.get('#password').setValue('hunter2hunter2')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(login).toHaveBeenCalledWith({ email: 'dev@example.com', password: 'hunter2hunter2' })
      expect(store.isAuthenticated).toBe(true)
      expect(router.currentRoute.value.name).toBe('home')
    })

    it('creates an account with the trimmed name and email', async () => {
      const signup = vi.fn(async () => makeUser())
      const { wrapper, router } = await mountLogin({ signup })
      await switchToSignup(wrapper)

      await wrapper.get('#name').setValue('  New Person  ')
      await wrapper.get('#email').setValue('new@example.com')
      await wrapper.get('#password').setValue('hunter2hunter2')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(signup).toHaveBeenCalledWith({
        email: 'new@example.com',
        name: 'New Person',
        password: 'hunter2hunter2'
      })
      expect(router.currentRoute.value.name).toBe('home')
    })

    it('keeps a rejected visitor on the login screen', async () => {
      const { wrapper, router, store } = await mountLogin({
        login: async () => {
          throw new AuthError('INVALID_CREDENTIALS', 'Invalid credentials.')
        }
      })

      await wrapper.get('#email').setValue('dev@example.com')
      await wrapper.get('#password').setValue('wrongpassword')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(store.isAuthenticated).toBe(false)
      expect(router.currentRoute.value.name).toBe('login')
    })
  })

  /** The store settles the outcome; saying it out loud is this screen's job. */
  describe('what the visitor is told', () => {
    it('greets a returning user by name after signing in', async () => {
      const { wrapper } = await mountLogin({ login: async () => makeUser({ name: 'Dev User' }) })

      await wrapper.get('#email').setValue('dev@example.com')
      await wrapper.get('#password').setValue('hunter2hunter2')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(toast.success).toHaveBeenCalledWith('Welcome back, Dev User.')
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('welcomes a new account by name after signing up', async () => {
      const { wrapper } = await mountLogin({ signup: async () => makeUser({ name: 'New Person' }) })
      await switchToSignup(wrapper)

      await wrapper.get('#name').setValue('New Person')
      await wrapper.get('#email').setValue('new@example.com')
      await wrapper.get('#password').setValue('hunter2hunter2')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(toast.success).toHaveBeenCalledWith('Welcome, New Person.')
    })

    it('shows the store message for bad credentials rather than a generic failure', async () => {
      const { wrapper } = await mountLogin({
        login: async () => {
          throw new AuthError('INVALID_CREDENTIALS', 'Invalid credentials.')
        }
      })

      await wrapper.get('#email').setValue('dev@example.com')
      await wrapper.get('#password').setValue('wrongpassword')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(toast.error).toHaveBeenCalledWith('Email or password is incorrect.')
      expect(toast.success).not.toHaveBeenCalled()
    })

    it('shows the store message for an email already registered', async () => {
      const { wrapper } = await mountLogin({
        signup: async () => {
          throw new AuthError('EMAIL_TAKEN', 'Email already in use.')
        }
      })
      await switchToSignup(wrapper)

      await wrapper.get('#name').setValue('New Person')
      await wrapper.get('#email').setValue('taken@example.com')
      await wrapper.get('#password').setValue('hunter2hunter2')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(toast.error).toHaveBeenCalledWith('That email is already registered.')
    })

    it('says nothing when the form never reaches the store', async () => {
      const { wrapper } = await mountLogin()

      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(toast.error).not.toHaveBeenCalled()
      expect(toast.success).not.toHaveBeenCalled()
    })
  })

  describe('revealing the password', () => {
    type Wrapper = Awaited<ReturnType<typeof mountLogin>>['wrapper']

    function typeOfPassword(wrapper: Wrapper) {
      return wrapper.get('#password').attributes('type')
    }

    it('reveals and re-hides the password', async () => {
      const { wrapper } = await mountLogin()
      const toggle = wrapper.get('.password-toggle')

      expect(typeOfPassword(wrapper)).toBe('password')

      await toggle.trigger('click')
      expect(typeOfPassword(wrapper)).toBe('text')

      await toggle.trigger('click')
      expect(typeOfPassword(wrapper)).toBe('password')
    })

    it('sits inside the field it toggles', async () => {
      const { wrapper } = await mountLogin()

      expect(wrapper.get('#password').element.parentElement!.className).toContain('password-field')
    })

    it('names the action it will perform for a screen reader', async () => {
      const { wrapper } = await mountLogin()
      const toggle = wrapper.get('.password-toggle')

      expect(toggle.attributes('aria-label')).toBe('Show password')

      await toggle.trigger('click')
      expect(toggle.attributes('aria-label')).toBe('Hide password')
    })

    /** A bare <button> in a form defaults to type="submit" — this one must not. */
    it('does not submit the form', async () => {
      const login = vi.fn(async () => makeUser())
      const { wrapper } = await mountLogin({ login })

      await wrapper.get('#email').setValue('dev@example.com')
      await wrapper.get('#password').setValue('hunter2hunter2')

      const toggle = wrapper.get('.password-toggle')
      expect(toggle.attributes('type')).toBe('button')

      await toggle.trigger('click')
      await flushPromises()

      expect(login).not.toHaveBeenCalled()
      expect(toast.success).not.toHaveBeenCalled()
    })

    it('re-hides the field after a successful sign in', async () => {
      const { wrapper } = await mountLogin({ login: async () => makeUser() })

      await wrapper.get('.password-toggle').trigger('click')
      expect(typeOfPassword(wrapper)).toBe('text')

      await wrapper.get('#email').setValue('dev@example.com')
      await wrapper.get('#password').setValue('hunter2hunter2')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(typeOfPassword(wrapper)).toBe('password')
    })

    /** The same input changes purpose between modes, so the reveal must not carry over. */
    it('re-hides the field when the visitor switches modes', async () => {
      const { wrapper } = await mountLogin()

      await wrapper.get('.password-toggle').trigger('click')
      expect(typeOfPassword(wrapper)).toBe('text')

      await switchToSignup(wrapper)
      expect(typeOfPassword(wrapper)).toBe('password')

      // And back the other way.
      await wrapper.get('.password-toggle').trigger('click')
      expect(typeOfPassword(wrapper)).toBe('text')

      const tab = wrapper.findAll('button[role="tab"]').find(b => b.text().includes('Sign in'))!
      await tab.trigger('click')
      expect(typeOfPassword(wrapper)).toBe('password')
    })
  })
})
