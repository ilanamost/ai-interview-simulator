import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory } from 'vue-router'
import { createPinia } from 'pinia'
import App from './App.vue'
import { createAppRouter } from '@/router'
import SettingsMenu from '@/cmps/SettingsMenu.vue'
import { signIn } from '@/test/auth-fixture'
import { clearAppliedTheme, stubMatchMedia } from '@/test/theme-fixture'
import { getStoredTheme } from '@/services/theme.service'

vi.mock('vue-sonner', async () => {
  const actual = await vi.importActual<typeof import('vue-sonner')>('vue-sonner')
  return { ...actual, toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }
})

async function mountApp(
  options: { authenticated?: boolean; avatarUrl?: string | null; path?: string } = {}
) {
  const { authenticated = true, avatarUrl = null, path = '/' } = options

  const router = createAppRouter(createMemoryHistory())
  const wrapper = mount(App, { global: { plugins: [createPinia(), router] } })

  if (authenticated) signIn({ avatarUrl })

  router.push(path)
  await router.isReady()
  await flushPromises()

  return { wrapper, router }
}

beforeEach(() => {
  localStorage.clear()
  clearAppliedTheme()
  stubMatchMedia()
})

describe('app header', () => {
  it('keeps the settings menu and avatar out of a signed-out header', async () => {
    const { wrapper } = await mountApp({ authenticated: false })

    expect(wrapper.findComponent(SettingsMenu).exists()).toBe(false)
    expect(wrapper.find('.avatar').exists()).toBe(false)
    expect(wrapper.get('.brand').text()).toContain('AI Interview Simulator')
  })

  it('shows the settings menu once signed in', async () => {
    const { wrapper } = await mountApp()

    expect(wrapper.findComponent(SettingsMenu).exists()).toBe(true)
  })

  it('falls back to a default user icon when there is no picture', async () => {
    const { wrapper } = await mountApp({ avatarUrl: null })

    expect(wrapper.find('.avatar').exists()).toBe(true)
    expect(wrapper.find('.avatar img').exists()).toBe(false)
  })

  it('shows the uploaded picture when there is one', async () => {
    const avatarUrl = 'data:image/png;base64,AAAA'
    const { wrapper } = await mountApp({ avatarUrl })

    const img = wrapper.get('.avatar img')
    expect(img.attributes('src')).toBe(avatarUrl)
    expect(img.attributes('alt')).toBe('Your profile picture')
  })

  it('links the avatar to the settings page', async () => {
    const { wrapper } = await mountApp()

    expect(wrapper.get('a.avatar').attributes('href')).toBe('/settings')
  })
})

describe('header nav', () => {
  /** Every linked route is behind `requiresAuth`, so a signed-out header must not offer them. */
  it('is absent for a signed-out visitor', async () => {
    const { wrapper } = await mountApp({ authenticated: false, path: '/login' })

    expect(wrapper.find('.app-nav').exists()).toBe(false)
  })

  it('links the three always-reachable routes once signed in', async () => {
    const { wrapper } = await mountApp()

    const links = wrapper.findAll('.app-nav .nav-link')
    expect(links.map(link => link.text())).toEqual(['Home', 'Practice', 'Reports'])
    expect(links.map(link => link.attributes('href'))).toEqual(['/', '/practice', '/reports'])
  })

  /** They are session-scoped and guarded: a static link to either just redirects away. */
  it('does not link the mid-flow interview or live report screens', async () => {
    const { wrapper } = await mountApp()

    const hrefs = wrapper.findAll('.app-nav .nav-link').map(link => link.attributes('href'))
    expect(hrefs).not.toContain('/interview')
    expect(hrefs).not.toContain('/report')
  })

  /**
   * The header already reaches /settings through the avatar and the gear menu, both
   * covered above. A third link in the nav bar would be redundant navigation.
   */
  it('does not repeat settings in the nav bar', async () => {
    const { wrapper } = await mountApp()

    const hrefs = wrapper.findAll('.app-nav .nav-link').map(link => link.attributes('href'))
    expect(hrefs).not.toContain('/settings')
    // Still reachable, just not from the nav: the avatar link is the other entry point.
    expect(wrapper.get('a.avatar').attributes('href')).toBe('/settings')
  })

  it.each([
    ['/', 'Home'],
    ['/practice', 'Practice'],
    ['/reports', 'Reports']
  ])('marks only the link for %s as the current page', async (path, expected) => {
    const { wrapper, router } = await mountApp({ path })
    await flushPromises()

    expect(router.currentRoute.value.path).toBe(path)
    const active = wrapper
      .findAll('.app-nav .nav-link.router-link-active')
      .map(link => link.text())
    expect(active).toEqual([expected])
  })
})

describe('theme toggle in the header', () => {
  it('is there for a signed-in user', async () => {
    const { wrapper } = await mountApp()

    expect(wrapper.find('.theme-toggle').exists()).toBe(true)
  })

  /** Unlike the settings menu: a color scheme is a device preference, not account data. */
  it('is there for a signed-out visitor on the login screen', async () => {
    const { wrapper, router } = await mountApp({ authenticated: false, path: '/login' })

    expect(router.currentRoute.value.name).toBe('login')
    expect(wrapper.findComponent(SettingsMenu).exists()).toBe(false)
    expect(wrapper.find('.theme-toggle').exists()).toBe(true)
  })

  it('offers dark mode while the page is light', async () => {
    const { wrapper } = await mountApp()

    expect(wrapper.get('.theme-toggle').attributes('aria-label')).toBe('Switch to dark mode')
  })

  it('offers light mode once the page is dark', async () => {
    document.documentElement.dataset.theme = 'dark'

    const { wrapper } = await mountApp()

    expect(wrapper.get('.theme-toggle').attributes('aria-label')).toBe('Switch to light mode')
  })

  it('flips its label and icon when clicked', async () => {
    const { wrapper } = await mountApp()
    const button = wrapper.get('.theme-toggle')
    const iconBefore = button.get('svg').classes().join(' ')

    await button.trigger('click')

    expect(button.attributes('aria-label')).toBe('Switch to light mode')
    expect(button.get('svg').classes().join(' ')).not.toBe(iconBefore)
  })

  it('re-colors the document and remembers the choice', async () => {
    const { wrapper } = await mountApp()

    await wrapper.get('.theme-toggle').trigger('click')

    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(getStoredTheme()).toBe('dark')
  })

  it('flips back on a second click', async () => {
    const { wrapper } = await mountApp()
    const button = wrapper.get('.theme-toggle')

    await button.trigger('click')
    await button.trigger('click')

    expect(button.attributes('aria-label')).toBe('Switch to dark mode')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  /** `type="button"` is what keeps it from submitting a form it happens to sit inside. */
  it('neither navigates nor submits anything', async () => {
    const { wrapper, router } = await mountApp()
    const button = wrapper.get('.theme-toggle')

    expect(button.attributes('type')).toBe('button')
    expect(button.element.tagName).toBe('BUTTON')

    await button.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.fullPath).toBe('/')
  })
})
