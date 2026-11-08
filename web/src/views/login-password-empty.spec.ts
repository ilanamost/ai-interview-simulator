import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import LoginView from './LoginView.vue'
import { createAppRouter } from '@/router'

vi.mock('vue-sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() }
}))

async function mountLogin() {
  const pinia = createPinia()
  setActivePinia(pinia)

  const router = createAppRouter(createMemoryHistory())
  router.push('/login')
  await router.isReady()

  return mount(LoginView, { global: { plugins: [pinia, router] }, attachTo: document.body })
}

async function switchToSignup(wrapper: Awaited<ReturnType<typeof mountLogin>>) {
  const tab = wrapper.findAll('button[role="tab"]').find(b => b.text().includes('Create account'))!
  await tab.trigger('click')
}

/** Mimics a browser filling a saved credential: it sets the value without any keystroke. */
function autofill(wrapper: Awaited<ReturnType<typeof mountLogin>>, value: string) {
  const input = wrapper.get('#password').element as HTMLInputElement
  input.value = value
  input.dispatchEvent(new Event('input'))
}

describe('LoginView password field on load', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('is empty on first render when signing in', async () => {
    const wrapper = await mountLogin()

    expect((wrapper.get('#password').element as HTMLInputElement).value).toBe('')
  })

  it('is empty on first render when creating an account', async () => {
    const wrapper = await mountLogin()
    await switchToSignup(wrapper)

    expect((wrapper.get('#password').element as HTMLInputElement).value).toBe('')
  })

  it('keeps current-password on sign in and uses new-password on sign up', async () => {
    const wrapper = await mountLogin()
    expect(wrapper.get('#password').attributes('autocomplete')).toBe('current-password')

    await switchToSignup(wrapper)
    expect(wrapper.get('#password').attributes('autocomplete')).toBe('new-password')
  })

  it('clears a value the browser filled in after mount', async () => {
    const wrapper = await mountLogin()

    autofill(wrapper, 'saved-secret')
    await vi.advanceTimersByTimeAsync(2000)
    await flushPromises()

    expect((wrapper.get('#password').element as HTMLInputElement).value).toBe('')
  })

  it('keeps what the visitor typed', async () => {
    const wrapper = await mountLogin()

    await wrapper.get('#password').trigger('keydown', { key: 'a' })
    await wrapper.get('#password').setValue('typed-by-user')
    await vi.advanceTimersByTimeAsync(2000)

    expect((wrapper.get('#password').element as HTMLInputElement).value).toBe('typed-by-user')
  })

  it('keeps what the visitor pasted', async () => {
    const wrapper = await mountLogin()

    await wrapper.get('#password').trigger('paste')
    await wrapper.get('#password').setValue('pasted-secret')
    await vi.advanceTimersByTimeAsync(2000)

    expect((wrapper.get('#password').element as HTMLInputElement).value).toBe('pasted-secret')
  })

  it('keeps a value entered through beforeinput (dictation, drop) while still clearing autofill', async () => {
    const wrapper = await mountLogin()
    const input = wrapper.get('#password').element as HTMLInputElement

    input.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertFromDrop', cancelable: true }))
    autofill(wrapper, 'dropped-secret')
    await vi.advanceTimersByTimeAsync(2000)

    expect(input.value).toBe('dropped-secret')
  })

  describe('readonly until the visitor interacts', () => {
    const input = (w: Awaited<ReturnType<typeof mountLogin>>) =>
      w.get('#password').element as HTMLInputElement

    it('renders readonly, focusable, and marked untouched', async () => {
      const wrapper = await mountLogin()

      expect(input(wrapper).readOnly).toBe(true)
      expect(input(wrapper).tabIndex).toBe(0)
      expect(wrapper.get('#password').classes()).toContain('is-untouched')
    })

    it.each(['focus', 'pointerdown', 'touchstart', 'keydown'])(
      'becomes editable on %s',
      async eventName => {
        const wrapper = await mountLogin()

        await wrapper.get('#password').trigger(eventName)

        expect(input(wrapper).readOnly).toBe(false)
        expect(wrapper.get('#password').classes()).not.toContain('is-untouched')
      }
    )

    it('keeps a value the browser fills after the visitor focused the field', async () => {
      const wrapper = await mountLogin()

      await wrapper.get('#password').trigger('focus')
      autofill(wrapper, 'picked-from-dropdown')
      await vi.advanceTimersByTimeAsync(2000)

      expect(input(wrapper).value).toBe('picked-from-dropdown')
    })

    it('does not break the show/hide toggle while untouched', async () => {
      const wrapper = await mountLogin()

      await wrapper.get('.password-toggle').trigger('click')

      expect(wrapper.get('#password').attributes('type')).toBe('text')
      expect(input(wrapper).readOnly).toBe(true)
    })

    it('starts every mount untouched and empty, as after logout and a return to /login', async () => {
      const first = await mountLogin()
      await first.get('#password').trigger('focus')
      await first.get('#password').setValue('typed')
      first.unmount()

      const second = await mountLogin()
      autofill(second, 'filled-on-return')
      await vi.advanceTimersByTimeAsync(2000)

      expect(input(second).value).toBe('')
      expect(input(second).readOnly).toBe(true)
      expect(second.get('#password').classes()).toContain('is-untouched')
    })
  })
})
