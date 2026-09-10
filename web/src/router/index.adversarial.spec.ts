import { describe, expect, it } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { createAppRouter, routes } from '@/router'
import { useAuthStore } from '@/stores/auth.store'
import { useInterviewStore } from '@/stores/interview.store'
import { signIn } from '@/test/auth-fixture'

/**
 * QA adversarial pass for plan 007's router gate. The delivered spec proves the
 * happy redirects; these push on the ordering and on the states where a leftover
 * `localStorage` interview session could out-rank the auth check.
 */

function makeRouter(authenticated: boolean) {
  setActivePinia(createPinia())
  if (authenticated) signIn()
  return createAppRouter(createMemoryHistory())
}

async function navigate(path: string, authenticated: boolean) {
  const router = makeRouter(authenticated)
  await router.push(path)
  await router.isReady()
  return router.currentRoute.value
}

describe('auth-first ordering under a resumable session', () => {
  it('sends a signed-out deep link to /interview to /login even with a live session', async () => {
    setActivePinia(createPinia())
    const interview = useInterviewStore()
    // A leftover resumable session is exactly the state that could satisfy the
    // session guard first and leak the user past the auth gate.
    interview.$patch({ session: { id: 'i1' } as never })

    const router = createAppRouter(createMemoryHistory())
    await router.push('/interview')
    await router.isReady()

    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.path).toBe('/login')
  })

  it('never lands a signed-out visitor on /practice from any protected deep link', async () => {
    for (const path of ['/', '/interview', '/report', '/settings', '/practice', '/nonsense']) {
      const route = await navigate(path, false)
      expect(route.name, `${path} should gate to login`).toBe('login')
    }
  })

  it('keeps /login itself reachable while signed out, or the app deadlocks', async () => {
    const route = await navigate('/login', false)

    expect(route.name).toBe('login')
  })

  it('declares requiresAuth on every route except /login', () => {
    const unguarded = routes
      .filter(route => 'component' in route && route.name !== 'login')
      .filter(route => route.meta?.requiresAuth !== true)

    expect(unguarded.map(route => route.name)).toEqual([])
  })

  it('leaves the catch-all redirect behind the gate rather than in front of it', async () => {
    const signedOut = await navigate('/some/deep/unknown/path', false)
    expect(signedOut.name).toBe('login')

    const signedIn = await navigate('/some/deep/unknown/path', true)
    expect(signedIn.name).toBe('home')
  })
})

describe('signing out mid-navigation', () => {
  it('bounces a subsequent navigation to /login once the store is cleared', async () => {
    const router = makeRouter(true)
    await router.push('/settings')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('settings')

    // Logout clears the store; back-navigation must not resurrect the app.
    useAuthStore().user = null
    await router.push('/')

    expect(router.currentRoute.value.name).toBe('login')
  })

  it('redirects a signed-in visitor off /login without bouncing back', async () => {
    const router = makeRouter(true)
    await router.push('/login')
    await router.isReady()

    expect(router.currentRoute.value.name).toBe('home')
    expect(router.currentRoute.value.path).toBe('/')
  })
})
