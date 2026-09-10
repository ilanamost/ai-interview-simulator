import { describe, expect, it, vi } from 'vitest'
import type { CookieOptions, Response } from 'express'
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  clearAuthCookies,
  setAuthCookies
} from './auth-cookie.js'

const TOKENS = { accessToken: 'access.jwt.value', refreshToken: 'refresh.jwt.value' }

function optionsFor(secure: boolean) {
  return { secure, accessMaxAgeMs: 900_000, refreshMaxAgeMs: 2_592_000_000 }
}

function fakeResponse() {
  const cookie = vi.fn()
  const clearCookie = vi.fn()
  const res = { cookie, clearCookie } as unknown as Response

  /** The options a given cookie name was set with. */
  const setWith = (name: string): CookieOptions =>
    cookie.mock.calls.find(call => call[0] === name)?.[2] as CookieOptions
  /** The options a given cookie name was cleared with. */
  const clearedWith = (name: string): CookieOptions =>
    clearCookie.mock.calls.find(call => call[0] === name)?.[1] as CookieOptions

  return { res, cookie, clearCookie, setWith, clearedWith }
}

describe('setAuthCookies', () => {
  it('uses SameSite=None when secure, so the cookies survive a cross-site request', () => {
    // Staging/production serve web/ from a different origin than api/, so a Lax
    // cookie would simply not be attached and every guarded request would 401.
    const { res, setWith } = fakeResponse()

    setAuthCookies(res, TOKENS, optionsFor(true))

    for (const name of [ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE]) {
      expect(setWith(name)).toMatchObject({ sameSite: 'none', secure: true, httpOnly: true })
    }
  })

  it('uses SameSite=Lax when not secure, so local dev over plain http is unchanged', () => {
    const { res, setWith } = fakeResponse()

    setAuthCookies(res, TOKENS, optionsFor(false))

    for (const name of [ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE]) {
      expect(setWith(name)).toMatchObject({ sameSite: 'lax', secure: false, httpOnly: true })
    }
  })

  it('never emits SameSite=None without Secure, which browsers reject outright', () => {
    for (const secure of [true, false]) {
      const { res, setWith } = fakeResponse()

      setAuthCookies(res, TOKENS, optionsFor(secure))

      for (const name of [ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE]) {
        const options = setWith(name)
        if (options.sameSite === 'none') expect(options.secure).toBe(true)
      }
    }
  })

  it('carries each token and its own max age', () => {
    const { res, cookie, setWith } = fakeResponse()

    setAuthCookies(res, TOKENS, optionsFor(true))

    expect(cookie).toHaveBeenCalledWith(ACCESS_TOKEN_COOKIE, TOKENS.accessToken, expect.anything())
    expect(cookie).toHaveBeenCalledWith(REFRESH_TOKEN_COOKIE, TOKENS.refreshToken, expect.anything())
    expect(setWith(ACCESS_TOKEN_COOKIE).maxAge).toBe(900_000)
    expect(setWith(REFRESH_TOKEN_COOKIE).maxAge).toBe(2_592_000_000)
  })
})

describe('clearAuthCookies', () => {
  it('clears with SameSite=None when secure', () => {
    const { res, clearedWith } = fakeResponse()

    clearAuthCookies(res, optionsFor(true))

    for (const name of [ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE]) {
      expect(clearedWith(name)).toMatchObject({ sameSite: 'none', secure: true, httpOnly: true })
    }
  })

  it('clears with SameSite=Lax when not secure', () => {
    const { res, clearedWith } = fakeResponse()

    clearAuthCookies(res, optionsFor(false))

    for (const name of [ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE]) {
      expect(clearedWith(name)).toMatchObject({ sameSite: 'lax', secure: false, httpOnly: true })
    }
  })

  it.each([true, false])(
    'clears with the exact attributes it set (secure: %s), or the browser keeps the cookie',
    secure => {
      // A clear whose SameSite/Secure/Path differ from the original set is a
      // different cookie as far as the browser is concerned, so logout silently
      // fails to log anyone out.
      const { res, setWith, clearedWith } = fakeResponse()

      setAuthCookies(res, TOKENS, optionsFor(secure))
      clearAuthCookies(res, optionsFor(secure))

      for (const name of [ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE]) {
        const setAttributes = { ...setWith(name) }
        delete setAttributes.maxAge
        expect(clearedWith(name)).toEqual(setAttributes)
      }
    }
  )
})
