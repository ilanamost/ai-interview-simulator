import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { toast } from 'vue-sonner'
import UserSettingsView from './UserSettingsView.vue'
import { useAuthStore } from '@/stores/auth.store'
import { AuthError, type AuthSource, type UpdateProfileInput } from '@/services/auth.service'
import { makeUser } from '@/test/auth-fixture'
import { MAX_AVATAR_BYTES } from '@/types/user'

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

/**
 * jsdom will not let a test assign `input.files`, so the picked file is defined on.
 * `FileReader` resolves on a real task, not a microtask, so one `flushPromises` is
 * not enough to see the encoded result.
 */
async function pickFile(wrapper: VueWrapper, file: File) {
  const input = wrapper.get('#avatar')
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })

  await input.trigger('change')

  // Settled once the preview has caught up or the file was refused outright.
  const deadline = Date.now() + 2000
  while (Date.now() < deadline) {
    await flushPromises()
    if (wrapper.find('.avatar img').exists() || vi.mocked(toast.error).mock.calls.length > 0) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }

  throw new Error('Timed out waiting for the picked file to be handled')
}

function makeImage(bytes: number, type = 'image/png'): File {
  return new File([new Uint8Array(bytes)], 'avatar.png', { type })
}

describe('UserSettingsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens seeded with the signed-in user', () => {
    const { wrapper } = mountSettings()

    expect((wrapper.get('#settings-name').element as HTMLInputElement).value).toBe('Dev User')
    expect((wrapper.get('#settings-email').element as HTMLInputElement).value).toBe('dev@example.com')
  })

  it('sends only the field that changed', async () => {
    const updateProfile = vi.fn(async (input: UpdateProfileInput) => makeUser({ name: input.name }))
    const { wrapper } = mountSettings(updateProfile)

    await wrapper.get('#settings-name').setValue('Renamed')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(updateProfile).toHaveBeenCalledWith({ name: 'Renamed' })
  })

  it('does not send an empty patch the API would reject', async () => {
    const updateProfile = vi.fn(async () => makeUser())
    const { wrapper } = mountSettings(updateProfile)

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(updateProfile).not.toHaveBeenCalled()
    expect(toast.info).toHaveBeenCalled()
  })

  it('refuses a bad email locally', async () => {
    const updateProfile = vi.fn(async () => makeUser())
    const { wrapper } = mountSettings(updateProfile)

    await wrapper.get('#settings-email').setValue('nope')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(updateProfile).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Enter a valid email address.')
  })

  describe('changing the password', () => {
    it('sends the new password together with the current one', async () => {
      const updateProfile = vi.fn(async () => makeUser())
      const { wrapper } = mountSettings(updateProfile)

      await wrapper.get('#current-password').setValue('oldpassword')
      await wrapper.get('#new-password').setValue('newpassword')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(updateProfile).toHaveBeenCalledWith({
        password: 'newpassword',
        currentPassword: 'oldpassword'
      })
    })

    it('asks for the current password rather than sending a request that would 400', async () => {
      const updateProfile = vi.fn(async () => makeUser())
      const { wrapper } = mountSettings(updateProfile)

      await wrapper.get('#new-password').setValue('newpassword')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(updateProfile).not.toHaveBeenCalled()
      expect(wrapper.text()).toContain('Enter your current password to change it.')
    })

    it('rejects a new password shorter than the API minimum', async () => {
      const updateProfile = vi.fn(async () => makeUser())
      const { wrapper } = mountSettings(updateProfile)

      await wrapper.get('#current-password').setValue('oldpassword')
      await wrapper.get('#new-password').setValue('short')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(updateProfile).not.toHaveBeenCalled()
      expect(wrapper.text()).toContain('Use at least 8 characters.')
    })

    /**
     * The store maps a 401 here to "wrong password", not "expired session", and leaves
     * the copy on `auth.error`; this proves that override still reaches the user now
     * that the view, not the store, fires the toast.
     */
    it('surfaces a wrong current password as such', async () => {
      const { wrapper } = mountSettings(async () => {
        throw new AuthError('INVALID_CREDENTIALS', 'Invalid credentials.')
      })

      await wrapper.get('#current-password').setValue('wrong')
      await wrapper.get('#new-password').setValue('newpassword')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(toast.error).toHaveBeenCalledWith('Your current password is incorrect.')
      expect(toast.success).not.toHaveBeenCalled()
    })
  })

  describe('revealing a password', () => {
    function toggleFor(wrapper: VueWrapper, fieldId: string) {
      return wrapper.get(`#${fieldId}`).element.parentElement!.querySelector('.password-toggle')!
    }

    function typeOf(wrapper: VueWrapper, fieldId: string) {
      return wrapper.get(`#${fieldId}`).attributes('type')
    }

    it('reveals and re-hides the field its own button belongs to', async () => {
      const { wrapper } = mountSettings()
      const toggle = wrapper.findAll('.password-toggle')[0]

      expect(typeOf(wrapper, 'current-password')).toBe('password')

      await toggle.trigger('click')
      expect(typeOf(wrapper, 'current-password')).toBe('text')

      await toggle.trigger('click')
      expect(typeOf(wrapper, 'current-password')).toBe('password')
    })

    it('leaves the other password field hidden', async () => {
      const { wrapper } = mountSettings()

      await wrapper.findAll('.password-toggle')[0].trigger('click')

      expect(typeOf(wrapper, 'current-password')).toBe('text')
      expect(typeOf(wrapper, 'new-password')).toBe('password')

      // And the reverse: revealing the new password must not expose the current one.
      await wrapper.findAll('.password-toggle')[0].trigger('click')
      await wrapper.findAll('.password-toggle')[1].trigger('click')

      expect(typeOf(wrapper, 'current-password')).toBe('password')
      expect(typeOf(wrapper, 'new-password')).toBe('text')
    })

    it('sits inside the field it toggles', () => {
      const { wrapper } = mountSettings()

      expect(toggleFor(wrapper, 'current-password')).toBeTruthy()
      expect(toggleFor(wrapper, 'new-password')).toBeTruthy()
    })

    it('names the action it will perform for a screen reader', async () => {
      const { wrapper } = mountSettings()
      const toggle = wrapper.findAll('.password-toggle')[0]

      expect(toggle.attributes('aria-label')).toBe('Show password')

      await toggle.trigger('click')
      expect(toggle.attributes('aria-label')).toBe('Hide password')
    })

    /** A bare <button> in a form defaults to type="submit" — this one must not. */
    it('does not submit the form', async () => {
      const updateProfile = vi.fn(async () => makeUser())
      const { wrapper } = mountSettings(updateProfile)

      await wrapper.get('#settings-name').setValue('Renamed')

      for (const toggle of wrapper.findAll('.password-toggle')) {
        expect(toggle.attributes('type')).toBe('button')
        await toggle.trigger('click')
      }
      await flushPromises()

      expect(updateProfile).not.toHaveBeenCalled()
      expect(toast.success).not.toHaveBeenCalled()
    })
  })

  describe('what the user is told after saving', () => {
    it('confirms a successful save', async () => {
      const { wrapper } = mountSettings(async () => makeUser({ name: 'Renamed' }))

      await wrapper.get('#settings-name').setValue('Renamed')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(toast.success).toHaveBeenCalledWith('Profile updated.')
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('shows the store message when the server refuses the change', async () => {
      const { wrapper } = mountSettings(async () => {
        throw new AuthError('EMAIL_TAKEN', 'Email already in use.')
      })

      await wrapper.get('#settings-email').setValue('taken@example.com')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(toast.error).toHaveBeenCalledWith('That email is already registered.')
      expect(toast.success).not.toHaveBeenCalled()
    })

    /** `??` would let an empty server message through as a blank toast; `||` must not. */
    it('falls back to readable copy when the server sends an error with no message', async () => {
      const { wrapper } = mountSettings(async () => {
        throw new AuthError('UNKNOWN_ERROR', '')
      })

      await wrapper.get('#settings-name').setValue('Renamed')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(toast.error).toHaveBeenCalledWith('Could not save your profile. Please try again.')
    })

    it('keeps the rejected edits on screen so they are not retyped', async () => {
      const { wrapper } = mountSettings(async () => {
        throw new AuthError('NETWORK_ERROR', 'offline')
      })

      await wrapper.get('#settings-name').setValue('Renamed')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(toast.error).toHaveBeenCalledWith(
        'Could not reach the server. Check your connection and try again.'
      )
      expect((wrapper.get('#settings-name').element as HTMLInputElement).value).toBe('Renamed')
    })
  })

  describe('the profile picture', () => {
    it('sends an accepted image as a data URL', async () => {
      const updateProfile = vi.fn(async (input: UpdateProfileInput) =>
        makeUser({ avatarUrl: input.avatarUrl ?? null })
      )
      const { wrapper } = mountSettings(updateProfile)

      await pickFile(wrapper, makeImage(64))
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      const patch = updateProfile.mock.calls[0][0]
      expect(patch.avatarUrl).toMatch(/^data:image\/png;base64,/)
      expect(Object.keys(patch)).toEqual(['avatarUrl'])
    })

    it('rejects an image over 2MB with a toast instead of a request the API would 400', async () => {
      const updateProfile = vi.fn(async () => makeUser())
      const { wrapper } = mountSettings(updateProfile)

      await pickFile(wrapper, makeImage(MAX_AVATAR_BYTES + 1))

      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('under 2.0MB'))

      // Nothing was staged, so a following save carries no avatar at all.
      await wrapper.get('#settings-name').setValue('Renamed')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(updateProfile).toHaveBeenCalledWith({ name: 'Renamed' })
    })

    it('rejects a file that is not an image the API stores', async () => {
      const { wrapper } = mountSettings()

      await pickFile(wrapper, makeImage(64, 'application/pdf'))

      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('PNG, JPEG, WebP, or GIF'))
    })

    it('clears an existing picture by sending an explicit null', async () => {
      const updateProfile = vi.fn(async () => makeUser({ avatarUrl: null }))
      const pinia = createPinia()
      setActivePinia(pinia)

      const store = useAuthStore()
      store.user = makeUser({ avatarUrl: 'data:image/png;base64,AAAA' })
      store.setSource(makeSource(updateProfile))

      const wrapper = mount(UserSettingsView, { global: { plugins: [pinia] } })

      const remove = wrapper.findAll('button').find(b => b.text().includes('Remove picture'))!
      await remove.trigger('click')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(updateProfile).toHaveBeenCalledWith({ avatarUrl: null })
    })
  })
})
