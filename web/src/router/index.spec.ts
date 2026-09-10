import { describe, expect, it } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { createAppRouter } from '@/router'
import HomeView from '@/views/HomeView.vue'
import LoginView from '@/views/LoginView.vue'
import SetupView from '@/views/SetupView.vue'
import { signIn } from '@/test/auth-fixture'

/**
 * The guards read both stores, so pinia has to be active before any navigation.
 * Every route but `/login` is behind `requiresAuth`, so tests sign in by default
 * and opt out only when the point is what a signed-out visitor sees.
 */
function makeRouter(authenticated = true) {
  setActivePinia(createPinia())
  if (authenticated) signIn()

  return createAppRouter(createMemoryHistory())
}

async function navigate(path: string, authenticated = true) {
  const router = makeRouter(authenticated)
  await router.push(path)
  await router.isReady()

  return router.currentRoute.value
}

describe('routes', () => {
  it('lands a signed-in visitor on the home page', async () => {
    const route = await navigate('/')

    expect(route.name).toBe('home')
    expect(route.matched[0].components?.default).toBe(HomeView)
  })

  it('serves the setup form from /practice', async () => {
    const route = await navigate('/practice')

    expect(route.name).toBe('setup')
    expect(route.matched[0].components?.default).toBe(SetupView)
  })

  it('serves the login screen from /login', async () => {
    const route = await navigate('/login', false)

    expect(route.name).toBe('login')
    expect(route.matched[0].components?.default).toBe(LoginView)
  })

  it('serves user settings from /settings', async () => {
    const route = await navigate('/settings')

    expect(route.name).toBe('settings')
  })

  it('serves the reports history from /reports', async () => {
    const route = await navigate('/reports')

    expect(route.name).toBe('reports')
  })

  it('serves one past report from /reports/:id, carrying the id through', async () => {
    const route = await navigate('/reports/abc-123')

    expect(route.name).toBe('report-detail')
    expect(route.params.id).toBe('abc-123')
  })

  /**
   * Load-bearing, not incidental: the header's "Reports" link stays lit on a detail
   * page only because both routes resolve through one shared parent record.
   */
  it('resolves both reports routes through a shared parent record', async () => {
    const list = await navigate('/reports')
    const listParent = list.matched[0]

    const detail = await navigate('/reports/abc-123')

    expect(detail.matched).toHaveLength(2)
    expect(detail.matched[0].path).toBe('/reports')
    expect(detail.matched[0].path).toBe(listParent.path)
    // The grouping parent renders nothing itself; the two children are the screens.
    expect(listParent.components).toBeFalsy()
  })

  /** Neither reports route depends on a live session, so neither may be bounced to setup. */
  it('lets a visitor with no interview in flight reach both reports routes', async () => {
    for (const path of ['/reports', '/reports/abc-123']) {
      const route = await navigate(path)

      expect(route.path).toBe(path)
    }
  })

  it('sends a signed-out visitor from either reports route to login', async () => {
    for (const path of ['/reports', '/reports/abc-123']) {
      const route = await navigate(path, false)

      expect(route.name).toBe('login')
    }
  })

  it('redirects an unknown url to the home page', async () => {
    const route = await navigate('/nope/not/a/page')

    expect(route.path).toBe('/')
    expect(route.name).toBe('home')
  })
})

describe('auth guard', () => {
  it('sends a signed-out visitor to the login screen instead of the home page', async () => {
    const route = await navigate('/', false)

    expect(route.name).toBe('login')
    expect(route.path).toBe('/login')
  })

  it('guards every non-public route, not just the home page', async () => {
    for (const path of ['/practice', '/interview', '/report', '/settings']) {
      const route = await navigate(path, false)

      expect(route.name).toBe('login')
    }
  })

  it('sends an unknown url from a signed-out visitor to the login screen', async () => {
    // The catch-all redirects to '/', which is itself guarded — no back door.
    const route = await navigate('/nope/not/a/page', false)

    expect(route.name).toBe('login')
  })

  it('sends an already signed-in visitor off the login screen to the home page', async () => {
    const route = await navigate('/login')

    expect(route.name).toBe('home')
    expect(route.path).toBe('/')
  })

  it('lets a signed-out visitor stay on the login screen', async () => {
    const route = await navigate('/login', false)

    expect(route.name).toBe('login')
  })
})

describe('session guards', () => {
  it('sends a session-less visit to /interview back to the practice form', async () => {
    const route = await navigate('/interview')

    expect(route.name).toBe('setup')
    expect(route.path).toBe('/practice')
  })

  it('sends a report-less visit to /report back to the practice form', async () => {
    const route = await navigate('/report')

    expect(route.name).toBe('setup')
    expect(route.path).toBe('/practice')
  })

  it('checks auth before the session, so a signed-out deep link never reaches the form', async () => {
    const route = await navigate('/interview', false)

    expect(route.name).toBe('login')
  })
})
