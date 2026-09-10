import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { toast } from 'vue-sonner'
import SettingsMenu from './SettingsMenu.vue'
import { createAppRouter } from '@/router'
import { useAuthStore } from '@/stores/auth.store'
import { AuthError, type AuthSource } from '@/services/auth.service'
import { makeUser, signIn } from '@/test/auth-fixture'

vi.mock('vue-sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() }
}))

function makeSource(overrides: Partial<AuthSource> = {}): AuthSource {
  return {
    signup: async () => makeUser(),
    login: async () => makeUser(),
    logout: async () => {},
    getCurrentUser: async () => makeUser(),
    updateProfile: async () => makeUser(),
    ...overrides
  }
}

async function mountMenu(overrides: Partial<AuthSource> = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  signIn()

  const router = createAppRouter(createMemoryHistory())
  router.push('/')
  await router.isReady()

  const store = useAuthStore()
  store.setSource(makeSource(overrides))

  const wrapper = mount(SettingsMenu, {
    global: { plugins: [pinia, router] },
    attachTo: document.body
  })

  return { wrapper, router, store }
}

function item(wrapper: Awaited<ReturnType<typeof mountMenu>>['wrapper'], label: string) {
  return wrapper.findAll('.menu-item').find(b => b.text().includes(label))
}

/** `/settings` is lazy-loaded, so its navigation settles a dynamic import later. */
async function waitFor(check: () => boolean, label: string, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    await flushPromises()
    if (check()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }

  throw new Error(`Timed out waiting for: ${label}`)
}

describe('SettingsMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
  })

  it('shows only the trigger until it is opened', async () => {
    const { wrapper } = await mountMenu()

    expect(wrapper.get('.menu-trigger').attributes('aria-label')).toBe('Settings')
    expect(wrapper.find('.menu-panel').exists()).toBe(false)
  })

  it('opens both actions when the trigger is clicked', async () => {
    const { wrapper } = await mountMenu()

    await wrapper.get('.menu-trigger').trigger('click')

    expect(wrapper.find('.menu-panel').exists()).toBe(true)
    expect(item(wrapper, 'User settings')).toBeDefined()
    expect(item(wrapper, 'Logout')).toBeDefined()
  })

  it('closes again on a second click of the trigger', async () => {
    const { wrapper } = await mountMenu()

    await wrapper.get('.menu-trigger').trigger('click')
    await wrapper.get('.menu-trigger').trigger('click')

    expect(wrapper.find('.menu-panel').exists()).toBe(false)
  })

  it('closes when Escape is pressed', async () => {
    const { wrapper } = await mountMenu()
    await wrapper.get('.menu-trigger').trigger('click')

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()

    expect(wrapper.find('.menu-panel').exists()).toBe(false)
  })

  it('opens user settings from the menu', async () => {
    const { wrapper, router } = await mountMenu()

    await wrapper.get('.menu-trigger').trigger('click')
    await item(wrapper, 'User settings')!.trigger('click')
    await waitFor(() => router.currentRoute.value.name === 'settings', 'settings route')

    expect(router.currentRoute.value.name).toBe('settings')
    expect(wrapper.find('.menu-panel').exists()).toBe(false)
  })

  it('clears the store and lands on the login screen on logout', async () => {
    const logout = vi.fn(async () => {})
    const { wrapper, router, store } = await mountMenu({ logout })

    await wrapper.get('.menu-trigger').trigger('click')
    await item(wrapper, 'Logout')!.trigger('click')
    await flushPromises()

    expect(logout).toHaveBeenCalled()
    expect(store.user).toBeNull()
    expect(store.isAuthenticated).toBe(false)
    expect(router.currentRoute.value.name).toBe('login')
  })

  it('still signs the user out locally when the server call fails', async () => {
    const { wrapper, router, store } = await mountMenu({
      logout: async () => {
        throw new Error('offline')
      }
    })

    await wrapper.get('.menu-trigger').trigger('click')
    await item(wrapper, 'Logout')!.trigger('click')
    await flushPromises()

    expect(store.isAuthenticated).toBe(false)
    expect(router.currentRoute.value.name).toBe('login')
  })

  /** The store computes the message but never shows it — this menu has to. */
  describe('what the user is told on logout', () => {
    it('says nothing on a clean logout: the login screen is the confirmation', async () => {
      const { wrapper } = await mountMenu({ logout: async () => {} })

      await wrapper.get('.menu-trigger').trigger('click')
      await item(wrapper, 'Logout')!.trigger('click')
      await flushPromises()

      expect(toast.success).not.toHaveBeenCalled()
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('warns that the server never confirmed it when the call fails', async () => {
      const { wrapper } = await mountMenu({
        logout: async () => {
          throw new Error('offline')
        }
      })

      await wrapper.get('.menu-trigger').trigger('click')
      await item(wrapper, 'Logout')!.trigger('click')
      await flushPromises()

      expect(toast.error).toHaveBeenCalledWith(
        'Signed out on this device, but the server could not be reached.'
      )
    })

    /** `??` would let an empty server message through as a blank toast; `||` must not. */
    it('falls back to readable copy when the failure carries no message', async () => {
      const { wrapper } = await mountMenu({
        logout: async () => {
          throw new AuthError('UNKNOWN_ERROR', '')
        }
      })

      await wrapper.get('.menu-trigger').trigger('click')
      await item(wrapper, 'Logout')!.trigger('click')
      await flushPromises()

      expect(toast.error).toHaveBeenCalledWith(
        'Signed out on this device, but the server could not be reached.'
      )
    })

    it('prefers the store message when the failure has one', async () => {
      const { wrapper } = await mountMenu({
        logout: async () => {
          throw new AuthError('NETWORK_ERROR', 'boom')
        }
      })

      await wrapper.get('.menu-trigger').trigger('click')
      await item(wrapper, 'Logout')!.trigger('click')
      await flushPromises()

      expect(toast.error).toHaveBeenCalledWith(
        'Could not reach the server. Check your connection and try again.'
      )
    })
  })
})
