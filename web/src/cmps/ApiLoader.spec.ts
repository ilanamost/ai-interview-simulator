import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import ApiLoader from './ApiLoader.vue'
import { useLoaderStore } from '@/stores/loader.store'
import { LOADER_GRACE_MS } from '@/services/loader.service'

function mountLoader() {
  return mount(ApiLoader)
}

describe('ApiLoader', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders nothing while no call is in flight', () => {
    const wrapper = mountLoader()

    expect(wrapper.find('[role="status"]').exists()).toBe(false)
  })

  it('shows an announced overlay once a call outlasts the grace delay', async () => {
    const wrapper = mountLoader()
    const loader = useLoaderStore()

    loader.start()
    await nextTick()
    await vi.advanceTimersByTimeAsync(LOADER_GRACE_MS)

    const status = wrapper.get('[role="status"]')
    expect(status.classes()).toContain('api-loader')
    expect(status.attributes('aria-live')).toBe('polite')
    expect(status.find('.spinner').exists()).toBe(true)
    expect(status.text()).toContain('Loading')
  })

  it('never shows for a call that settles inside the grace delay', async () => {
    const wrapper = mountLoader()
    const loader = useLoaderStore()

    loader.start()
    await nextTick()
    await vi.advanceTimersByTimeAsync(LOADER_GRACE_MS - 50)
    loader.stop()
    await nextTick()
    await vi.advanceTimersByTimeAsync(LOADER_GRACE_MS)

    expect(wrapper.find('[role="status"]').exists()).toBe(false)
  })

  it('hides as soon as the last call settles', async () => {
    const wrapper = mountLoader()
    const loader = useLoaderStore()

    loader.start()
    await nextTick()
    await vi.advanceTimersByTimeAsync(LOADER_GRACE_MS)
    expect(wrapper.find('[role="status"]').exists()).toBe(true)

    loader.stop()
    await nextTick()

    expect(wrapper.find('[role="status"]').exists()).toBe(false)
  })

  it('shows for a call already in flight when it mounts, as at startup', async () => {
    useLoaderStore().start()

    const wrapper = mountLoader()
    await vi.advanceTimersByTimeAsync(LOADER_GRACE_MS)

    expect(wrapper.find('[role="status"]').exists()).toBe(true)
  })
})

/**
 * `main.ts` mounts the loader on its own node before the boot-time `fetchMe()`, so a
 * cold start is covered. Both HTML entries must carry that node, or the app throws
 * on boot — `404.html` is what GitHub Pages serves for every deep link.
 */
describe('ApiLoader mount point', () => {
  it.each(['index.html', '404.html'])('is present in %s, ahead of the app root', name => {
    const html = readFileSync(resolve(process.cwd(), name), 'utf8')

    expect(html).toContain('<div id="api-loader"></div>')
    expect(html.indexOf('id="api-loader"')).toBeLessThan(html.indexOf('id="app"'))
    expect(html).not.toContain('startup-loader')
  })
})
