import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
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

function fill(w: W, value: string) {
  pw(w).value = value
  pw(w).dispatchEvent(new Event('input'))
}

async function toSignup(w: W) {
  await w
    .findAll('button[role="tab"]')
    .find(b => b.text().includes('Create account'))!
    .trigger('click')
}

describe('LoginView password clearing (adversarial)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('clears an autofill that lands at the very last check (1500 ms)', async () => {
    const w = await mountLogin()
    await vi.advanceTimersByTimeAsync(1499)
    fill(w, 'late')
    await vi.advanceTimersByTimeAsync(2)
    expect(pw(w).value).toBe('')
  })

  it('leaves an autofill that lands after the window (documented caveat)', async () => {
    const w = await mountLogin()
    await vi.advanceTimersByTimeAsync(1600)
    fill(w, 'very-late')
    await vi.advanceTimersByTimeAsync(5000)
    expect(pw(w).value).toBe('very-late')
  })

  it('keeps typing that starts at mount, before the first timer fires', async () => {
    const w = await mountLogin()
    await w.get('#password').trigger('keydown', { key: 'a' })
    fill(w, 'a')
    await vi.advanceTimersByTimeAsync(2000)
    expect(pw(w).value).toBe('a')
  })

  it('does not clear the model when the visitor typed, even if DOM is re-set later', async () => {
    const w = await mountLogin()
    await w.get('#password').trigger('keydown', { key: 'x' })
    await w.get('#password').setValue('mine')
    await vi.advanceTimersByTimeAsync(2000)
    await w.get('form').trigger('submit')
    expect(pw(w).value).toBe('mine')
  })

  it('mode switch inside the window keeps clearing an untouched autofill', async () => {
    const w = await mountLogin()
    await vi.advanceTimersByTimeAsync(50)
    await toSignup(w)
    fill(w, 'filled-after-switch')
    await vi.advanceTimersByTimeAsync(2000)
    expect(pw(w).value).toBe('')
  })

  it('mode switch after typing keeps the typed password', async () => {
    const w = await mountLogin()
    await w.get('#password').trigger('keydown', { key: 'a' })
    await w.get('#password').setValue('typed')
    await toSignup(w)
    await vi.advanceTimersByTimeAsync(2000)
    expect(pw(w).value).toBe('typed')
  })

  it.each([
    'insertFromDrop',
    'insertReplacementText',
    'insertText',
    'insertFromPaste',
    'insertCompositionText'
  ])('keeps a %s edit (dictation, drag-drop, IME) inside the window', async inputType => {
    const w = await mountLogin()
    pw(w).dispatchEvent(new InputEvent('beforeinput', { inputType, data: 'x', cancelable: true }))
    fill(w, 'dictated-or-dropped')
    await vi.advanceTimersByTimeAsync(2000)
    expect(pw(w).value).toBe('dictated-or-dropped')
  })

  it('clears an autofill that lands after a mode switch re-opens the window', async () => {
    const w = await mountLogin()
    await vi.advanceTimersByTimeAsync(1600)
    await toSignup(w)
    fill(w, 'filled-for-signup')
    await vi.advanceTimersByTimeAsync(2000)
    expect(pw(w).value).toBe('')
  })

  it('submitting an empty password with a filled-in form never throws and shows an error', async () => {
    const w = await mountLogin()
    await w.get('#email').setValue('a@b.co')
    await w.get('form').trigger('submit')
    await flushPromises()
    expect(pw(w).value).toBe('')
    expect(w.text().length).toBeGreaterThan(0)
  })

  it('survives unmount mid-window (no timer fires on a dead component)', async () => {
    const w = await mountLogin()
    w.unmount()
    await expect(vi.advanceTimersByTimeAsync(3000)).resolves.not.toThrow()
  })

  it('handles a very long autofill value and rapid repeated fills', async () => {
    const w = await mountLogin()
    for (let i = 0; i < 50; i++) fill(w, 'x'.repeat(10000))
    await vi.advanceTimersByTimeAsync(2000)
    expect(pw(w).value).toBe('')
  })
})
