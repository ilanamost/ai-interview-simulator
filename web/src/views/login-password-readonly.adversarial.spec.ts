import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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
const fill = (w: W, v: string) => {
  pw(w).value = v
  pw(w).dispatchEvent(new Event('input'))
}
const tab = (w: W, label: string) =>
  w.findAll('button[role="tab"]').find(b => b.text().includes(label))!.trigger('click')

describe('password readonly gate (adversarial)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('starts readonly + is-untouched, empty, still focusable (no disabled / tabindex=-1)', async () => {
    const w = await mountLogin()
    expect(pw(w).readOnly).toBe(true)
    expect(pw(w).classList.contains('is-untouched')).toBe(true)
    expect(pw(w).disabled).toBe(false)
    expect(pw(w).getAttribute('tabindex')).toBeNull()
    expect(pw(w).value).toBe('')
    expect(w.get('label[for="password"]').text()).toBe('Password')
  })

  for (const [name, fire] of [
    ['focus', (w: W) => w.get('#password').trigger('focus')],
    ['pointerdown', (w: W) => w.get('#password').trigger('pointerdown')],
    ['touchstart', (w: W) => w.get('#password').trigger('touchstart')],
    ['keydown', (w: W) => w.get('#password').trigger('keydown', { key: 'Tab' })],
    ['paste', (w: W) => w.get('#password').trigger('paste')]
  ] as const) {
    it(`${name} drops readonly and the class`, async () => {
      const w = await mountLogin()
      await fire(w)
      expect(pw(w).readOnly).toBe(false)
      expect(pw(w).classList.contains('is-untouched')).toBe(false)
    })
  }

  it('real focus() via the label click path drops readonly', async () => {
    const w = await mountLogin()
    pw(w).focus()
    await flushPromises()
    expect(pw(w).readOnly).toBe(false)
  })

  it('eye toggle works while untouched, and does not itself touch the field', async () => {
    const w = await mountLogin()
    await w.get('.password-field button').trigger('click')
    expect(pw(w).type).toBe('text')
    expect(pw(w).readOnly).toBe(true)
    await w.get('.password-field button').trigger('click')
    expect(pw(w).type).toBe('password')
  })

  it('mode switch while untouched stays readonly and clears a late fill; after touch it never re-locks', async () => {
    const w = await mountLogin()
    await tab(w, 'Create account')
    expect(pw(w).readOnly).toBe(true)
    fill(w, 'late')
    await vi.advanceTimersByTimeAsync(2000)
    expect(pw(w).value).toBe('')
    await w.get('#password').trigger('focus')
    await tab(w, 'Sign in')
    expect(pw(w).readOnly).toBe(false)
    await tab(w, 'Create account')
    expect(pw(w).readOnly).toBe(false)
  })

  it('submit while untouched unlocks the field and keeps whatever is in it', async () => {
    const w = await mountLogin()
    await w.get('form').trigger('submit')
    expect(pw(w).readOnly).toBe(false)
  })

  it('remount (logout -> login) starts empty and untouched again', async () => {
    const w1 = await mountLogin()
    await w1.get('#password').trigger('keydown', { key: 'a' })
    await w1.get('#password').setValue('secret')
    w1.unmount()
    const w2 = await mountLogin()
    expect(pw(w2).value).toBe('')
    expect(pw(w2).readOnly).toBe(true)
    expect(pw(w2).classList.contains('is-untouched')).toBe(true)
  })

  it('readonly input still reports an untouched fill as blank to the form (no leak on later submit)', async () => {
    const w = await mountLogin()
    fill(w, 'hidden-fill')
    await vi.advanceTimersByTimeAsync(2000)
    expect(pw(w).value).toBe('')
  })
})

describe('form.scss password rule', () => {
  const scss = readFileSync(resolve(process.cwd(), 'src/styles/cmps/form.scss'), 'utf8')
  it('is scoped under .password-field, uses tokens, no @import', () => {
    expect(scss).not.toMatch(/@import/)
    const i = scss.indexOf('.is-untouched:-webkit-autofill')
    expect(i).toBeGreaterThan(-1)
    expect(scss.slice(i, i + 400)).toMatch(/var\(--clr-surface\)/)
    expect(scss.slice(0, i)).toMatch(/\.password-field\s*\{/)
  })
  it('UserSettingsView never applies is-untouched', () => {
    const v = readFileSync(resolve(process.cwd(), 'src/views/UserSettingsView.vue'), 'utf8')
    expect(v).not.toMatch(/is-untouched/)
    expect(v).not.toMatch(/<style/)
  })
  it('--clr-surface token exists', () => {
    const v = readFileSync(resolve(process.cwd(), 'src/styles/setup/variables.scss'), 'utf8')
    expect(v).toMatch(/--clr-surface:/)
  })
})
