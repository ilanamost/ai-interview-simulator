import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import ApiLoader from './ApiLoader.vue'
import { useLoaderStore } from '@/stores/loader.store'
import { LOADER_GRACE_MS } from '@/services/loader.service'
import { AuthError, createHttpAuthSource } from '@/services/auth.service'
import { request } from '@/services/interview-http.service'
import { AuthErrorCode } from '@/types/auth'
import { makeUser } from '@/test/auth-fixture'

/**
 * QA adversarial pass for plan 023. Drives the real fetch wrappers into a mounted
 * ApiLoader, and abuses the store directly (flapping, stray stops, unmount mid-grace).
 */

const BASE_URL = 'http://localhost:3001'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as Response
}

function delayed(ms: number, response: Response): Promise<Response> {
  return new Promise(resolve => setTimeout(() => resolve(response), ms))
}

const overlay = (wrapper: ReturnType<typeof mount>) => wrapper.find('[role="status"]')

describe('ApiLoader — adversarial', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('restarts the grace delay when calls flap on and off, so rapid short calls never flash', async () => {
    const wrapper = mount(ApiLoader)
    const loader = useLoaderStore()

    for (let i = 0; i < 5; i++) {
      loader.start()
      await nextTick()
      await vi.advanceTimersByTimeAsync(LOADER_GRACE_MS - 50)
      loader.stop()
      await nextTick()
      expect(overlay(wrapper).exists()).toBe(false)
    }

    loader.start()
    await nextTick()
    await vi.advanceTimersByTimeAsync(LOADER_GRACE_MS - 1)
    expect(overlay(wrapper).exists()).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(overlay(wrapper).exists()).toBe(true)
  })

  it('stray stops before any call cannot hide a later slow call', async () => {
    const wrapper = mount(ApiLoader)
    const loader = useLoaderStore()

    loader.stop()
    loader.stop()
    loader.stop()
    expect(loader.pending).toBe(0)

    loader.start()
    await nextTick()
    await vi.advanceTimersByTimeAsync(LOADER_GRACE_MS)
    expect(overlay(wrapper).exists()).toBe(true)
  })

  it('leaves no timer behind when unmounted mid-grace', async () => {
    const wrapper = mount(ApiLoader)
    useLoaderStore().start()
    await nextTick()
    expect(vi.getTimerCount()).toBe(1)

    wrapper.unmount()

    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the overlay up across two overlapping real auth calls until the failing one settles', async () => {
    const wrapper = mount(ApiLoader)
    fetchMock
      .mockImplementationOnce(() => delayed(300, jsonResponse(200, { user: makeUser() })))
      .mockImplementationOnce(() => delayed(600, jsonResponse(500, {})))
    const auth = createHttpAuthSource(BASE_URL)

    const first = auth.login({ email: 'a@example.com', password: 'pw' })
    const second = auth.login({ email: 'b@example.com', password: 'pw' })
    const secondSettled = expect(second).rejects.toBeInstanceOf(AuthError)

    await vi.advanceTimersByTimeAsync(LOADER_GRACE_MS)
    expect(overlay(wrapper).exists()).toBe(true)

    await vi.advanceTimersByTimeAsync(300 - LOADER_GRACE_MS)
    await first
    expect(overlay(wrapper).exists()).toBe(true)

    await vi.advanceTimersByTimeAsync(300)
    await secondSettled
    await nextTick()
    expect(overlay(wrapper).exists()).toBe(false)
    expect(useLoaderStore().pending).toBe(0)
  })

  it('clears the overlay after a network failure (fetch rejects) on the interview wrapper', async () => {
    const wrapper = mount(ApiLoader)
    fetchMock.mockImplementationOnce(
      () => new Promise((_resolve, reject) => setTimeout(() => reject(new TypeError('Failed to fetch')), 400))
    )

    const call = request(BASE_URL, '/api/interview/x')
    const settled = expect(call).rejects.toMatchObject({ code: 'NETWORK_ERROR' })

    await vi.advanceTimersByTimeAsync(LOADER_GRACE_MS)
    expect(overlay(wrapper).exists()).toBe(true)

    await vi.advanceTimersByTimeAsync(400)
    await settled
    await nextTick()
    expect(overlay(wrapper).exists()).toBe(false)
  })

  /**
   * The 401 -> refresh -> retry chain is tracked as one unit. Tracked per fetch, each hop
   * dropped the counter to 0 and re-armed the grace timer, so three back-to-back 100 ms
   * calls would leave the user waiting ~300 ms with no overlay at all.
   */
  it('shows the overlay during a 401 -> refresh -> retry chain that outlasts the grace delay', async () => {
    const wrapper = mount(ApiLoader)
    const unauthenticated = { error: { code: AuthErrorCode.Unauthenticated, message: 'expired' } }
    fetchMock
      .mockImplementationOnce(() => delayed(100, jsonResponse(401, unauthenticated)))
      .mockImplementationOnce(() => delayed(100, jsonResponse(200, {})))
      .mockImplementationOnce(() => delayed(100, jsonResponse(200, { ok: true })))

    const call = request(BASE_URL, '/api/interview/x')
    let sawOverlay = false
    for (let elapsed = 0; elapsed < 300; elapsed += 10) {
      await vi.advanceTimersByTimeAsync(10)
      if (overlay(wrapper).exists()) sawOverlay = true
    }
    await call

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(sawOverlay).toBe(true)
  })
})
