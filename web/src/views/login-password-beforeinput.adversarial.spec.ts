import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import LoginView from './LoginView.vue'
import { createAppRouter } from '@/router'

vi.mock('vue-sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() }
}))

type W = Awaited<ReturnType<typeof mountLogin>>

async function mountLogin() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createAppRouter(createMemoryHistory())
  router.push('/login')
  await router.isReady()
  return mount(LoginView, { global: { plugins: [pinia, router] }, attachTo: document.body })
}

const pw = (w: W) => w.get('#password').element as HTMLInputElement
const fill = (w: W, v: string) => {
  pw(w).value = v
  pw(w).dispatchEvent(new Event('input'))
}
const tab = (w: W, label: string) =>
  w.findAll('button[role="tab"]').find(b => b.text().includes(label))!.trigger('click')

describe('LoginView beforeinput ownership (adversarial)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  for (const inputType of ['insertText', 'insertFromPaste', 'insertFromDrop', 'insertReplacementText', 'insertCompositionText']) {
    it(`keeps a value entered via beforeinput ${inputType}`, async () => {
      const w = await mountLogin()
      pw(w).dispatchEvent(new InputEvent('beforeinput', { inputType, data: 'x' }))
      fill(w, 'owned')
      await vi.advanceTimersByTimeAsync(3000)
      expect(pw(w).value).toBe('owned')
    })
  }

  it('beforeinput with no value change still hands the field over: later fill is kept (known leniency)', async () => {
    const w = await mountLogin()
    pw(w).dispatchEvent(new InputEvent('beforeinput', { inputType: 'deleteContentBackward' }))
    await vi.advanceTimersByTimeAsync(50)
    fill(w, 'autofilled-later')
    await vi.advanceTimersByTimeAsync(3000)
    expect(pw(w).value).toBe('autofilled-later')
  })

  it('autofill that also fires beforeinput is indistinguishable from the user and is kept', async () => {
    const w = await mountLogin()
    pw(w).dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertReplacementText' }))
    fill(w, 'saved')
    await vi.advanceTimersByTimeAsync(3000)
    expect(pw(w).value).toBe('saved')
  })

  it('mode switch after typing does not reopen the window', async () => {
    const w = await mountLogin()
    pw(w).dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: 'a' }))
    fill(w, 'a')
    await vi.advanceTimersByTimeAsync(2000)
    await tab(w, 'Create account')
    fill(w, 'late-fill')
    await vi.advanceTimersByTimeAsync(3000)
    expect(pw(w).value).toBe('late-fill')
  })

  it('mode switch before typing clears a late fill, and the window runs a full 1.5 s from the switch', async () => {
    const w = await mountLogin()
    await vi.advanceTimersByTimeAsync(2000)
    await tab(w, 'Create account')
    await vi.advanceTimersByTimeAsync(1400)
    fill(w, 'late')
    await vi.advanceTimersByTimeAsync(200)
    expect(pw(w).value).toBe('')
  })

  it('rapid mode toggling leaves no stray timers and still clears, then keeps typing', async () => {
    const w = await mountLogin()
    for (let i = 0; i < 30; i++) await tab(w, i % 2 ? 'Sign in' : 'Create account')
    fill(w, 'auto')
    await vi.advanceTimersByTimeAsync(2000)
    expect(pw(w).value).toBe('')
    expect(vi.getTimerCount()).toBe(0)
    pw(w).dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: 'k' }))
    fill(w, 'kept')
    await tab(w, 'Sign in')
    await vi.advanceTimersByTimeAsync(2000)
    expect(pw(w).value).toBe('kept')
  })

  it('unmount right after a mode switch leaves no pending timers', async () => {
    const w = await mountLogin()
    await tab(w, 'Create account')
    w.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
