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

/**
 * Adversarial pass over the login reveal toggle (QA, plan 012). `LoginView.spec.ts`
 * covers the happy path the plan names; this file goes after the seams around it —
 * the value surviving a type swap, a burst of clicks, the toggle in signup mode, the
 * failure path the plan never specified, and the pre-existing field behaviour the
 * new `.password-field` wrapper could have quietly broken.
 */

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

  useAuthStore().setSource(makeSource(overrides))

  return mount(LoginView, { global: { plugins: [pinia, router] } })
}

type Wrapper = Awaited<ReturnType<typeof mountLogin>>

async function clickTab(wrapper: Wrapper, label: string) {
  const tab = wrapper.findAll('button[role="tab"]').find(b => b.text().includes(label))!
  await tab.trigger('click')
}

function passwordInput(wrapper: Wrapper) {
  return wrapper.get('#password').element as HTMLInputElement
}

function typeOfPassword(wrapper: Wrapper) {
  return wrapper.get('#password').attributes('type')
}

describe('the reveal toggle under abuse', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  /**
   * Swapping an input's `type` is the one move that can silently drop what the user
   * typed. The bound value must survive a round trip in both directions.
   */
  it('never loses the typed password across a type swap', async () => {
    const wrapper = await mountLogin()
    const toggle = wrapper.get('.password-toggle')

    await wrapper.get('#password').setValue('hunter2hunter2')

    await toggle.trigger('click')
    expect(typeOfPassword(wrapper)).toBe('text')
    expect(passwordInput(wrapper).value).toBe('hunter2hunter2')

    await toggle.trigger('click')
    expect(typeOfPassword(wrapper)).toBe('password')
    expect(passwordInput(wrapper).value).toBe('hunter2hunter2')
  })

  it('holds a long, punctuation-heavy secret intact through a reveal', async () => {
    const wrapper = await mountLogin()
    const secret = `${'a'.repeat(4096)}<script>"'&%$#@!`

    await wrapper.get('#password').setValue(secret)
    await wrapper.get('.password-toggle').trigger('click')

    expect(typeOfPassword(wrapper)).toBe('text')
    expect(passwordInput(wrapper).value).toBe(secret)
    expect(passwordInput(wrapper).value).toHaveLength(secret.length)
  })

  it('stays in step with an odd and an even burst of clicks', async () => {
    const wrapper = await mountLogin()
    const toggle = wrapper.get('.password-toggle')

    // Odd count ends revealed.
    for (let i = 0; i < 21; i++) await toggle.trigger('click')
    expect(typeOfPassword(wrapper)).toBe('text')
    expect(toggle.attributes('aria-label')).toBe('Hide password')

    // One more back to even ends hidden — no drift, no stuck state.
    await toggle.trigger('click')
    expect(typeOfPassword(wrapper)).toBe('password')
    expect(toggle.attributes('aria-label')).toBe('Show password')
  })

  /** A stray second toggle would mean the wrapper got applied to the wrong field too. */
  it('puts exactly one toggle on the form, in either mode', async () => {
    const wrapper = await mountLogin()

    expect(wrapper.findAll('.password-toggle')).toHaveLength(1)
    expect(wrapper.findAll('.password-field')).toHaveLength(1)

    await clickTab(wrapper, 'Create account')

    expect(wrapper.findAll('.password-toggle')).toHaveLength(1)
    expect(wrapper.findAll('.password-field')).toHaveLength(1)
    // The name field arrived without picking up a reveal control of its own.
    expect(wrapper.get('#name').element.parentElement!.className).not.toContain('password-field')
  })

  it('works the same in create-account mode, not just sign in', async () => {
    const wrapper = await mountLogin()
    await clickTab(wrapper, 'Create account')

    const toggle = wrapper.get('.password-toggle')
    expect(typeOfPassword(wrapper)).toBe('password')

    await toggle.trigger('click')
    expect(typeOfPassword(wrapper)).toBe('text')
    expect(toggle.attributes('aria-label')).toBe('Hide password')
  })

  /**
   * `type="button"` is the plan's named risk. Asserting the attribute proves the markup;
   * this proves the consequence — a submit would have run `validate()` and painted the
   * empty form with errors.
   */
  it('raises no validation errors when clicked on an untouched form', async () => {
    const login = vi.fn(async () => makeUser())
    const wrapper = await mountLogin({ login })

    await wrapper.get('.password-toggle').trigger('click')
    await flushPromises()

    expect(login).not.toHaveBeenCalled()
    expect(wrapper.find('.field-error').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Enter your email.')
    expect(wrapper.text()).not.toContain('Enter your password.')
  })

  /**
   * Documented, not endorsed. The plan resets the reveal on success and on a mode
   * switch, and says nothing about a rejected attempt — so the password stays on
   * screen while the visitor corrects it. Pinned here so a future change to that
   * behaviour is a deliberate decision rather than an accident.
   */
  it('leaves the password revealed after a rejected sign in', async () => {
    const wrapper = await mountLogin({
      login: async () => {
        throw new AuthError('INVALID_CREDENTIALS', 'Invalid credentials.')
      }
    })

    await wrapper.get('.password-toggle').trigger('click')
    await wrapper.get('#email').setValue('dev@example.com')
    await wrapper.get('#password').setValue('wrongpassword')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(toast.error).toHaveBeenCalled()
    expect(typeOfPassword(wrapper)).toBe('text')
    expect(passwordInput(wrapper).value).toBe('wrongpassword')
  })

  it('re-hides even when the visitor re-clicks the tab they are already on', async () => {
    const wrapper = await mountLogin()

    await wrapper.get('.password-toggle').trigger('click')
    expect(typeOfPassword(wrapper)).toBe('text')

    await clickTab(wrapper, 'Sign in')

    expect(wrapper.get('h1').text()).toBe('Sign in')
    expect(typeOfPassword(wrapper)).toBe('password')
  })
})

/** The new wrapper sits between the label and the input — none of this may have moved. */
describe('the field the toggle was added to is otherwise unchanged', () => {
  it('keeps the label bound to the input', async () => {
    const wrapper = await mountLogin()
    const label = wrapper.findAll('label').find(l => l.text() === 'Password')!

    expect(label.attributes('for')).toBe('password')
    expect(wrapper.get('#password').attributes('class')).toContain('control')
  })

  it('still flips autocomplete with the mode, revealed or not', async () => {
    const wrapper = await mountLogin()

    expect(wrapper.get('#password').attributes('autocomplete')).toBe('current-password')

    await clickTab(wrapper, 'Create account')
    expect(wrapper.get('#password').attributes('autocomplete')).toBe('new-password')

    await wrapper.get('.password-toggle').trigger('click')
    expect(typeOfPassword(wrapper)).toBe('text')
    expect(wrapper.get('#password').attributes('autocomplete')).toBe('new-password')
  })

  it('still shows the password error below the field, outside the wrapper', async () => {
    const wrapper = await mountLogin()

    await wrapper.get('#email').setValue('dev@example.com')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    const error = wrapper.findAll('.field-error').find(e => e.text() === 'Enter your password.')!
    expect(error.attributes('role')).toBe('alert')
    expect(error.element.parentElement!.className).not.toContain('password-field')
  })

  /** The icon is decorative; the button's `aria-label` is the only name a reader needs. */
  it('hides the icon from assistive tech in both states', async () => {
    const wrapper = await mountLogin()
    const toggle = wrapper.get('.password-toggle')

    expect(toggle.get('svg').attributes('aria-hidden')).toBe('true')

    await toggle.trigger('click')
    expect(toggle.get('svg').attributes('aria-hidden')).toBe('true')
  })
})
