import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { toast } from 'vue-sonner'
import UserSettingsView from './UserSettingsView.vue'
import { useAuthStore } from '@/stores/auth.store'
import type { AuthSource } from '@/services/auth.service'
import { makeUser } from '@/test/auth-fixture'

/**
 * Adversarial pass over the two show/hide password toggles (QA, plan 010). The
 * happy path is already covered in `UserSettingsView.spec.ts`; these push on the
 * ways a reveal toggle usually breaks — rapid clicking desyncing the icon from
 * the input `type`, interleaving the two toggles until they leak into each other,
 * a reveal quietly mutating or truncating the value, and what the toggle state
 * does across a save that clears the fields.
 */

vi.mock('vue-sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() }
}))

function makeSource(updateProfile: AuthSource['updateProfile']): AuthSource {
  return {
    signup: async () => makeUser(),
    login: async () => makeUser(),
    logout: async () => {},
    getCurrentUser: async () => makeUser(),
    updateProfile
  }
}

function mountSettings(updateProfile: AuthSource['updateProfile'] = async () => makeUser()) {
  const pinia = createPinia()
  setActivePinia(pinia)

  const store = useAuthStore()
  store.user = makeUser()
  store.setSource(makeSource(updateProfile))

  const wrapper = mount(UserSettingsView, { global: { plugins: [pinia] } })

  return { wrapper, store }
}

const CURRENT = 0
const NEW = 1

function toggle(wrapper: VueWrapper, index: number) {
  return wrapper.findAll('.password-toggle')[index]
}

function typeOf(wrapper: VueWrapper, fieldId: string) {
  return wrapper.get(`#${fieldId}`).attributes('type')
}

function valueOf(wrapper: VueWrapper, fieldId: string) {
  return (wrapper.get(`#${fieldId}`).element as HTMLInputElement).value
}

/** The icon is the only visual signal of state, so it must not drift from `type`. */
function iconsOf(wrapper: VueWrapper, index: number) {
  return toggle(wrapper, index).findAll('svg').length
}

describe('rapid and repeated toggling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lands on the right state after an impatient burst of clicks', async () => {
    const { wrapper } = mountSettings()

    // 7 clicks — odd, so it must end revealed, not wherever a race left it.
    for (let i = 0; i < 7; i++) await toggle(wrapper, CURRENT).trigger('click')
    expect(typeOf(wrapper, 'current-password')).toBe('text')

    // One more makes it even again.
    await toggle(wrapper, CURRENT).trigger('click')
    expect(typeOf(wrapper, 'current-password')).toBe('password')
  })

  it('keeps the label and the icon in step with the input type throughout', async () => {
    const { wrapper } = mountSettings()

    for (let click = 0; click < 6; click++) {
      const revealed = typeOf(wrapper, 'new-password') === 'text'

      expect(toggle(wrapper, NEW).attributes('aria-label')).toBe(
        revealed ? 'Hide password' : 'Show password'
      )
      // Exactly one icon renders at a time — never both, never neither.
      expect(iconsOf(wrapper, NEW)).toBe(1)

      await toggle(wrapper, NEW).trigger('click')
    }
  })

  it('never submits the form no matter how many times it is clicked', async () => {
    const updateProfile = vi.fn(async () => makeUser())
    const { wrapper } = mountSettings(updateProfile)

    await wrapper.get('#settings-name').setValue('Renamed')

    for (let i = 0; i < 10; i++) {
      await toggle(wrapper, CURRENT).trigger('click')
      await toggle(wrapper, NEW).trigger('click')
    }
    await flushPromises()

    expect(updateProfile).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })
})

describe('the two toggles under interleaved use', () => {
  it('holds independence across an interleaved sequence, not just one flip each', async () => {
    const { wrapper } = mountSettings()

    // current on, new on, current off — the new field must still be revealed.
    await toggle(wrapper, CURRENT).trigger('click')
    await toggle(wrapper, NEW).trigger('click')
    await toggle(wrapper, CURRENT).trigger('click')

    expect(typeOf(wrapper, 'current-password')).toBe('password')
    expect(typeOf(wrapper, 'new-password')).toBe('text')

    // And the mirror image of the same sequence.
    await toggle(wrapper, NEW).trigger('click')
    await toggle(wrapper, CURRENT).trigger('click')
    await toggle(wrapper, NEW).trigger('click')

    expect(typeOf(wrapper, 'current-password')).toBe('text')
    expect(typeOf(wrapper, 'new-password')).toBe('text')
  })

  it('gives each field its own button rather than one button driving both', async () => {
    const { wrapper } = mountSettings()

    expect(wrapper.findAll('.password-toggle')).toHaveLength(2)

    // Each toggle lives inside the wrapper of the input it controls.
    for (const id of ['current-password', 'new-password']) {
      const field = wrapper.get(`#${id}`).element.parentElement!
      expect(field.querySelectorAll('.password-toggle')).toHaveLength(1)
    }
  })
})

describe('revealing must not disturb the value', () => {
  it('preserves a long password with punctuation and unicode exactly', async () => {
    const { wrapper } = mountSettings()

    const nasty = `${'a'.repeat(4000)} <script>&"'é中文🚀 `
    await wrapper.get('#new-password').setValue(nasty)

    await toggle(wrapper, NEW).trigger('click')
    expect(typeOf(wrapper, 'new-password')).toBe('text')
    expect(valueOf(wrapper, 'new-password')).toBe(nasty)

    await toggle(wrapper, NEW).trigger('click')
    expect(valueOf(wrapper, 'new-password')).toBe(nasty)
  })

  it('still sends the typed password after it was revealed', async () => {
    const updateProfile = vi.fn(async () => makeUser())
    const { wrapper } = mountSettings(updateProfile)

    await wrapper.get('#current-password').setValue('oldpassword')
    await wrapper.get('#new-password').setValue('newpassword')

    await toggle(wrapper, CURRENT).trigger('click')
    await toggle(wrapper, NEW).trigger('click')

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(updateProfile).toHaveBeenCalledWith({
      password: 'newpassword',
      currentPassword: 'oldpassword'
    })
  })

  it('does not let a revealed empty field slip past the local validation', async () => {
    const updateProfile = vi.fn(async () => makeUser())
    const { wrapper } = mountSettings(updateProfile)

    await toggle(wrapper, CURRENT).trigger('click')
    await toggle(wrapper, NEW).trigger('click')
    await wrapper.get('#new-password').setValue('short')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(updateProfile).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Use at least 8 characters.')
  })
})

/**
 * QA note (plan 010): `resetFromUser()` clears both password values after a save
 * but leaves the reveal flags alone, so a field the user revealed stays `type=text`
 * while empty — the next password typed into it is on screen without being asked
 * for again. Low severity (the field is empty at that moment and the user did opt
 * in once), so this pins the behaviour as it actually ships rather than failing the
 * build; flagged in the QA report as a re-mask-after-save recommendation.
 */
describe('reveal state across a successful save', () => {
  it('leaves the fields revealed after the save empties them', async () => {
    const { wrapper } = mountSettings(async () => makeUser({ name: 'Renamed' }))

    await wrapper.get('#current-password').setValue('oldpassword')
    await wrapper.get('#new-password').setValue('newpassword')
    await toggle(wrapper, CURRENT).trigger('click')
    await toggle(wrapper, NEW).trigger('click')

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    // The values are cleared, as intended.
    expect(valueOf(wrapper, 'current-password')).toBe('')
    expect(valueOf(wrapper, 'new-password')).toBe('')

    // The reveal survives — documented, not endorsed. See the note above.
    expect(typeOf(wrapper, 'current-password')).toBe('text')
    expect(typeOf(wrapper, 'new-password')).toBe('text')
  })
})
