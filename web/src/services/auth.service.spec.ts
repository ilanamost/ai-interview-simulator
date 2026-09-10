import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthError, createHttpAuthSource } from './auth.service'
import { makeUser } from '@/test/auth-fixture'

const BASE_URL = 'http://localhost:3001'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as Response
}

function emptyResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new Error('no body')
    }
  } as unknown as Response
}

describe('createHttpAuthSource', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /**
   * The single most breakable detail of this feature: the auth cookies are HttpOnly,
   * so the browser only stores and replays them when the request opts in. A call
   * without this silently 401s on everything afterwards.
   */
  it('sends credentials on every call, including the public ones', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { user: makeUser() }))
    const source = createHttpAuthSource(BASE_URL)

    await source.signup({ email: 'a@b.co', name: 'A', password: 'hunter2hunter2' })
    await source.login({ email: 'a@b.co', password: 'hunter2hunter2' })
    await source.getCurrentUser()
    await source.updateProfile({ name: 'A' })

    fetchMock.mockResolvedValue(emptyResponse(204))
    await source.logout()

    expect(fetchMock.mock.calls.length).toBe(5)
    for (const [, init] of fetchMock.mock.calls) {
      expect(init.credentials).toBe('include')
    }
  })

  it('unwraps the user envelope from signup', async () => {
    const user = makeUser({ id: 'u9' })
    fetchMock.mockResolvedValue(jsonResponse(201, { user }))
    const source = createHttpAuthSource(BASE_URL)

    const result = await source.signup({ email: 'a@b.co', name: 'A', password: 'hunter2hunter2' })

    expect(result).toEqual(user)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${BASE_URL}/api/auth/signup`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ email: 'a@b.co', name: 'A', password: 'hunter2hunter2' })
  })

  it('posts no body on logout, because the API rejects any field there', async () => {
    fetchMock.mockResolvedValue(emptyResponse(204))
    const source = createHttpAuthSource(BASE_URL)

    await source.logout()

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${BASE_URL}/api/auth/logout`)
    expect(init.body).toBeUndefined()
  })

  it('maps a non-2xx into an AuthError carrying the backend code and message', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(409, { error: { code: 'EMAIL_TAKEN', message: 'Email already in use.' } })
    )
    const source = createHttpAuthSource(BASE_URL)

    await expect(
      source.signup({ email: 'a@b.co', name: 'A', password: 'hunter2hunter2' })
    ).rejects.toMatchObject({ code: 'EMAIL_TAKEN', message: 'Email already in use.' })
  })

  it('maps a network failure into a NETWORK_ERROR AuthError', async () => {
    fetchMock.mockRejectedValue(new Error('connection refused'))
    const source = createHttpAuthSource(BASE_URL)

    await expect(source.login({ email: 'a@b.co', password: 'x' })).rejects.toBeInstanceOf(AuthError)
    await expect(source.login({ email: 'a@b.co', password: 'x' })).rejects.toMatchObject({
      code: 'NETWORK_ERROR'
    })
  })

  describe('getCurrentUser', () => {
    it('returns null when nobody is signed in', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'Not signed in.' } })
      )
      const source = createHttpAuthSource(BASE_URL)

      await expect(source.getCurrentUser()).resolves.toBeNull()
    })

    it('rotates the session and retries once when the access token has expired', async () => {
      const user = makeUser()
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'Expired.' } })
        )
        .mockResolvedValueOnce(jsonResponse(200, { user }))
        .mockResolvedValueOnce(jsonResponse(200, { user }))
      const source = createHttpAuthSource(BASE_URL)

      await expect(source.getCurrentUser()).resolves.toEqual(user)
      expect(fetchMock.mock.calls[1][0]).toBe(`${BASE_URL}/api/auth/refresh`)
      expect(fetchMock.mock.calls[2][0]).toBe(`${BASE_URL}/api/user`)
    })

    it('gives up as signed out when the refresh is also rejected', async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'Expired.' } })
        )
        .mockResolvedValueOnce(
          jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'Revoked.' } })
        )
      const source = createHttpAuthSource(BASE_URL)

      await expect(source.getCurrentUser()).resolves.toBeNull()
      // One refresh attempt only — no retry loop.
      expect(fetchMock.mock.calls.length).toBe(2)
    })
  })

  describe('updateProfile', () => {
    it('patches only the fields it is given', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { user: makeUser({ name: 'Renamed' }) }))
      const source = createHttpAuthSource(BASE_URL)

      await source.updateProfile({ name: 'Renamed' })

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe(`${BASE_URL}/api/user`)
      expect(init.method).toBe('PATCH')
      expect(JSON.parse(init.body)).toEqual({ name: 'Renamed' })
    })

    it('does not treat a wrong current password as an expired session', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(401, {
          error: { code: 'INVALID_CREDENTIALS', message: 'Current password is incorrect.' }
        })
      )
      const source = createHttpAuthSource(BASE_URL)

      await expect(
        source.updateProfile({ password: 'newpassword', currentPassword: 'wrong' })
      ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
      // No refresh attempt: a 401 here is about the password, not the cookie.
      expect(fetchMock.mock.calls.length).toBe(1)
    })
  })
})
