import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { createAppRouter } from './index'
import { signIn } from '@/test/auth-fixture'

/*
 * QA re-verification of the /reports route nesting.
 *
 * `/reports/:id` moved from a flat sibling to a child of a component-less `/reports`
 * parent so the two share a matched record (which is what keeps the header's "Reports"
 * link lit on a detail page). Restructuring a route tree is exactly the kind of change
 * that quietly breaks guards, named lookups, or the catch-all, so this pins the parts
 * that must not have moved.
 */

function makeRouter() {
  return createAppRouter(createMemoryHistory())
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

describe('the reports routes still resolve exactly as they did when flat', () => {
  it('resolves both names to the same paths as before', () => {
    const router = makeRouter()

    expect(router.resolve({ name: 'reports' }).path).toBe('/reports')
    expect(router.resolve({ name: 'report-detail', params: { id: 'abc' } }).path).toBe('/reports/abc')
  })

  it('navigates to the list by path and lands on the list route', async () => {
    const router = makeRouter()
    signIn()

    await router.push('/reports')

    expect(router.currentRoute.value.name).toBe('reports')
    expect(router.currentRoute.value.matched.at(-1)?.name).toBe('reports')
  })

  it('navigates to one report by path, carrying its id', async () => {
    const router = makeRouter()
    signIn()

    await router.push('/reports/past-interview-7')

    expect(router.currentRoute.value.name).toBe('report-detail')
    expect(router.currentRoute.value.params.id).toBe('past-interview-7')
  })

  it('shares a matched parent record between the two, which is what lights the nav', async () => {
    const router = makeRouter()
    signIn()

    await router.push('/reports')
    const listParent = router.currentRoute.value.matched[0]

    await router.push('/reports/abc')
    const detailParent = router.currentRoute.value.matched[0]

    expect(listParent.path).toBe('/reports')
    expect(detailParent.path).toBe('/reports')
    expect(router.currentRoute.value.matched).toHaveLength(2)
  })

  it('leaves the component-less parent unnamed, so nothing can navigate to a blank page', () => {
    const router = makeRouter()

    // The parent is the first matched record on both routes. It must stay nameless and
    // component-less: a named parent would be reachable and would render nothing at all.
    const parent = router.resolve('/reports').matched[0]
    expect(parent.path).toBe('/reports')
    expect(parent.name).toBeUndefined()
    expect(parent.components).toBeFalsy()

    // Only the two real routes are navigable, still under their original names.
    const names = router.getRoutes().map(route => route.name)
    expect(names).toContain('reports')
    expect(names).toContain('report-detail')
  })

  /** Both leaves still carry their own component, so neither page renders blank. */
  it('keeps a component on each of the two reachable reports routes', () => {
    const router = makeRouter()

    for (const path of ['/reports', '/reports/abc']) {
      expect(router.resolve(path).matched.at(-1)?.components).toBeTruthy()
    }
  })

  it('still resolves an id that looks like a nested path segment', async () => {
    const router = makeRouter()
    signIn()

    // ':id' matches one segment: a second one must not silently resolve to the list.
    const resolved = router.resolve('/reports/a/b')
    expect(resolved.name).not.toBe('reports')
    expect(resolved.name).not.toBe('report-detail')
  })
})

describe('the auth guard still covers both reports routes', () => {
  it('sends a signed-out visitor from the list to login', async () => {
    const router = makeRouter()

    await router.push('/reports')

    expect(router.currentRoute.value.name).toBe('login')
  })

  /** The parent carries the meta; this proves it merges down rather than being skipped. */
  it('sends a signed-out visitor from a report detail to login', async () => {
    const router = makeRouter()

    await router.push('/reports/abc')

    expect(router.currentRoute.value.name).toBe('login')
  })

  it('reports requiresAuth on both resolved routes', () => {
    const router = makeRouter()

    expect(router.resolve('/reports').meta.requiresAuth).toBe(true)
    expect(router.resolve('/reports/abc').meta.requiresAuth).toBe(true)
  })

  it('lets a signed-in visitor reach both', async () => {
    const router = makeRouter()
    signIn()

    await router.push('/reports')
    expect(router.currentRoute.value.name).toBe('reports')

    await router.push('/reports/abc')
    expect(router.currentRoute.value.name).toBe('report-detail')
  })

  /**
   * The whole point of the separate history store: neither route may inherit the live
   * interview guards, or a user with no session in flight could not read a past report.
   */
  it('does not require a live session or report on either route', () => {
    const router = makeRouter()

    for (const path of ['/reports', '/reports/abc']) {
      expect(router.resolve(path).meta.requiresSession).toBeUndefined()
      expect(router.resolve(path).meta.requiresReport).toBeUndefined()
    }
  })

  it('reaches a past report with no interview session in flight at all', async () => {
    const router = makeRouter()
    signIn()

    await router.push('/reports/abc')

    expect(router.currentRoute.value.name).toBe('report-detail')
  })
})

describe('the rest of the route table is undisturbed', () => {
  it.each([
    ['/', 'home'],
    ['/practice', 'setup'],
    ['/settings', 'settings'],
    ['/login', 'login']
  ])('still resolves %s to %s', (path, name) => {
    expect(makeRouter().resolve(path).name).toBe(name)
  })

  it('still sends an unknown path to the catch-all rather than into /reports', async () => {
    const router = makeRouter()
    signIn()

    await router.push('/no-such-page')

    expect(router.currentRoute.value.path).toBe('/')
  })

  it('does not let the reports parent swallow a lookalike top-level path', () => {
    const router = makeRouter()

    // '/reportsomething' must not match '/reports' or its children.
    const resolved = router.resolve('/reportsomething')
    expect(resolved.name).not.toBe('reports')
    expect(resolved.name).not.toBe('report-detail')
  })

  it('keeps the live report route separate from the history routes', () => {
    const router = makeRouter()

    expect(router.resolve('/report').name).toBe('report')
    expect(router.resolve('/report').meta.requiresReport).toBe(true)
    // The live report still demands a report in the store; history never does.
    expect(router.resolve('/reports').meta.requiresReport).toBeUndefined()
  })
})
