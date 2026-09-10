import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { AuthError, createHttpAuthSource, type AuthSource } from './auth.service'
import { useAuthStore } from '@/stores/auth.store'
import { makeUser } from '@/test/auth-fixture'

/**
 * QA adversarial pass for plan 007, frontend side. The delivered spec covers the
 * happy path and the single refresh-and-retry; these tests push on what happens
 * when the retry itself fails, when the server answers with something that is not
 * JSON, and when the user hammers a control.
 */

const BASE_URL = 'http://localhost:3001'

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

/** A proxy or dev-server error page: a non-2xx whose body is HTML, not our envelope. */
function htmlResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON')
    }
  } as unknown as Response
}

describe('refresh-and-retry under pressure', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('stops after the refresh itself is rejected, without attempting the retry', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'Signed out.' } })
    )

    const source = createHttpAuthSource(BASE_URL)
    await expect(source.getCurrentUser()).resolves.toBeNull()

    // GET /user -> POST /auth/refresh (401) -> give up. No third call.
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
      `${BASE_URL}/api/user`,
      `${BASE_URL}/api/auth/refresh`
    ])
  })

  it('retries exactly once and never loops when the refresh succeeds but the retry 401s', async () => {
    const unauthenticated = () =>
      jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'Signed out.' } })
    fetchMock
      .mockResolvedValueOnce(unauthenticated())
      .mockResolvedValueOnce(jsonResponse(200, { user: makeUser() }))
      .mockResolvedValue(unauthenticated())

    const source = createHttpAuthSource(BASE_URL)
    await expect(source.getCurrentUser()).resolves.toBeNull()

    // GET /user -> POST /auth/refresh (ok) -> GET /user. Three calls, then it stops.
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
      `${BASE_URL}/api/user`,
      `${BASE_URL}/api/auth/refresh`,
      `${BASE_URL}/api/user`
    ])
  })

  it('sends credentials on the refresh call too, or the rotation cookie is dropped', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'Expired.' } })
      )
      .mockResolvedValueOnce(jsonResponse(200, { user: makeUser() }))
      .mockResolvedValueOnce(jsonResponse(200, { user: makeUser() }))

    await createHttpAuthSource(BASE_URL).getCurrentUser()

    for (const call of fetchMock.mock.calls) {
      expect(call[1]).toMatchObject({ credentials: 'include' })
    }
  })

  it('replays the PATCH method and body intact on the retry, not a bare GET', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'Expired.' } })
      )
      .mockResolvedValueOnce(jsonResponse(200, { user: makeUser() }))
      .mockResolvedValueOnce(jsonResponse(200, { user: makeUser({ name: 'Renamed' }) }))

    const user = await createHttpAuthSource(BASE_URL).updateProfile({ name: 'Renamed' })

    expect(user.name).toBe('Renamed')
    const retry = fetchMock.mock.calls[2]
    expect(retry[0]).toBe(`${BASE_URL}/api/user`)
    expect(retry[1]).toMatchObject({
      method: 'PATCH',
      body: JSON.stringify({ name: 'Renamed' }),
      credentials: 'include'
    })
  })

  it('surfaces a wrong current password without burning a refresh', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, {
        error: { code: 'INVALID_CREDENTIALS', message: 'Your current password is incorrect.' }
      })
    )

    const source = createHttpAuthSource(BASE_URL)
    await expect(
      source.updateProfile({ password: 'new-password-1', currentPassword: 'wrong' })
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('malformed server answers', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('turns an HTML error page into a user-safe AuthError, not a JSON parse crash', async () => {
    fetchMock.mockResolvedValueOnce(htmlResponse(502))

    const source = createHttpAuthSource(BASE_URL)
    const err = await source.login({ email: 'a@b.co', password: 'x' }).catch(e => e)

    expect(err).toBeInstanceOf(AuthError)
    expect(err.code).toBe('UNKNOWN_ERROR')
    expect(err.message).not.toContain('SyntaxError')
    expect(err.message).not.toContain('<')
  })

  it('does not mistake a 500 for a signed-out session and try to refresh', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(500, { error: { code: 'INTERNAL_ERROR', message: 'Something failed.' } })
    )

    const source = createHttpAuthSource(BASE_URL)
    await expect(source.getCurrentUser()).rejects.toBeInstanceOf(AuthError)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('rapid repeated interaction on the auth store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  function stubSource(overrides: Partial<AuthSource> = {}): AuthSource {
    return {
      signup: vi.fn(),
      login: vi.fn(),
      logout: vi.fn().mockResolvedValue(undefined),
      getCurrentUser: vi.fn().mockResolvedValue(null),
      updateProfile: vi.fn(),
      ...overrides
    }
  }

  it('leaves the user signed out after five concurrent logout clicks', async () => {
    const store = useAuthStore()
    const source = stubSource()
    store.setSource(source)
    store.user = makeUser()

    await Promise.all(Array.from({ length: 5 }, () => store.logout()))

    expect(store.user).toBeNull()
    expect(store.isAuthenticated).toBe(false)
    expect(store.status).toBe('ready')
  })

  it('still clears local state when every logout call rejects', async () => {
    const store = useAuthStore()
    store.setSource(
      stubSource({ logout: vi.fn().mockRejectedValue(new AuthError('NETWORK_ERROR', 'offline')) })
    )
    store.user = makeUser()

    await Promise.all([store.logout(), store.logout()])

    expect(store.user).toBeNull()
    expect(store.error).toBeTruthy()
  })

  it('does not leave the store stuck busy when a failed login is retried', async () => {
    const store = useAuthStore()
    store.setSource(
      stubSource({
        login: vi.fn().mockRejectedValue(new AuthError('INVALID_CREDENTIALS', 'nope'))
      })
    )

    for (let i = 0; i < 3; i += 1) {
      await store.login({ email: 'a@b.co', password: 'wrong' })
    }

    expect(store.status).toBe('ready')
    expect(store.isBusy).toBe(false)
    expect(store.isAuthenticated).toBe(false)
  })

  it('reports the same message for an unknown email as for a wrong password', async () => {
    const store = useAuthStore()
    store.setSource(
      stubSource({
        login: vi
          .fn()
          .mockRejectedValue(new AuthError('INVALID_CREDENTIALS', 'Email or password is incorrect.'))
      })
    )

    await store.login({ email: 'nobody@example.com', password: 'whatever' })
    const unknownEmailMessage = store.error

    await store.login({ email: 'dev@example.com', password: 'wrong' })

    expect(store.error).toBe(unknownEmailMessage)
    expect(store.error).not.toMatch(/no account|not found|unknown/i)
  })

  it('does not sign the user in when fetchMe fails at boot', async () => {
    const store = useAuthStore()
    store.setSource(
      stubSource({
        getCurrentUser: vi.fn().mockRejectedValue(new AuthError('NETWORK_ERROR', 'offline'))
      })
    )

    await expect(store.fetchMe()).resolves.toBe(false)
    expect(store.user).toBeNull()
    expect(store.status).toBe('ready')
  })
})
