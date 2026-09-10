import { describe, expect, it } from 'vitest'
import type { Express } from 'express'
import type request from 'supertest'
import { agentFor, buildHarness, signUp } from '../test/app-harness.js'
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from './auth-cookie.js'

/**
 * QA adversarial pass for plan 014's SameSite fix.
 *
 * The unit spec next door asserts the ternary through a mocked Response, and
 * auth.routes.spec.ts checks signup and logout. This file attacks the same fix
 * from the outside instead: it parses the REAL `Set-Cookie` header off EVERY
 * endpoint that issues or clears an auth cookie, in BOTH cookie modes, so a
 * regression cannot hide in a path nobody thought to re-check. It also pins the
 * local-dev header shape literally, because plan 014 promises this change is
 * invisible to anyone running the app today.
 */

const COOKIES = [ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE]

/** Every `Set-Cookie` header on a response, as raw strings. */
function setCookieHeaders(res: request.Response): string[] {
  return (res.headers['set-cookie'] as unknown as string[] | undefined) ?? []
}

/** An auth cookie's attributes, lowercased keys, excluding the name=value pair. */
function attributesOf(header: string): Map<string, string> {
  const attributes = new Map<string, string>()
  for (const part of header.split(';').slice(1)) {
    const [rawKey, ...rest] = part.trim().split('=')
    attributes.set((rawKey ?? '').toLowerCase(), rest.join('='))
  }
  return attributes
}

function authCookieHeaders(res: request.Response): string[] {
  return setCookieHeaders(res).filter(header => COOKIES.some(name => header.startsWith(`${name}=`)))
}

/** Signs up, then exercises the refresh endpoint, returning every response that set a cookie. */
async function collectIssuingResponses(app: Express) {
  const { agent, res: signupRes } = await signUp(app)
  const refreshRes = await agent.post('/api/auth/refresh')

  const loginAgent = agentFor(app)
  const loginRes = await loginAgent
    .post('/api/auth/login')
    .send({ email: 'ada@example.com', password: 'correct-horse-battery' })

  return { signupRes, refreshRes, loginRes, agent }
}

describe('auth cookie attributes across every issuing endpoint', () => {
  it.each([true, false])(
    'never emits SameSite=None without Secure on ANY endpoint (cookieSecure: %s)',
    async cookieSecure => {
      // The invariant browsers enforce: a None cookie without Secure is dropped
      // outright, which would silently log every deployed user out.
      const { app } = buildHarness({ cookieSecure })

      const { signupRes, refreshRes, loginRes, agent } = await collectIssuingResponses(app)
      const logoutRes = await agent.post('/api/auth/logout')

      const headers = [signupRes, refreshRes, loginRes, logoutRes].flatMap(authCookieHeaders)
      expect(headers.length).toBeGreaterThan(0)

      for (const header of headers) {
        const attributes = attributesOf(header)
        if (attributes.get('samesite')?.toLowerCase() === 'none') {
          expect(attributes.has('secure')).toBe(true)
        }
      }
    }
  )

  it('sets SameSite=None; Secure on signup, login AND refresh in production mode', async () => {
    // Refresh is the path the existing coverage never checked, and it is the one
    // a cross-site session depends on most: it fires on every access-token expiry.
    const { app } = buildHarness({ cookieSecure: true })

    const { signupRes, refreshRes, loginRes } = await collectIssuingResponses(app)

    for (const res of [signupRes, refreshRes, loginRes]) {
      const headers = authCookieHeaders(res)
      expect(headers).toHaveLength(2)
      for (const header of headers) {
        const attributes = attributesOf(header)
        expect(attributes.get('samesite')).toBe('None')
        expect(attributes.has('secure')).toBe(true)
        expect(attributes.has('httponly')).toBe(true)
        expect(attributes.get('path')).toBe('/')
      }
    }
  })

  it('leaves local dev byte-identical to the pre-change behavior', async () => {
    // Plan 014 is additive for production only. If this pins-to-literal test ever
    // fails, someone changed what `npm run dev` does to a normal user's session.
    const { app } = buildHarness({ cookieSecure: false })

    const { signupRes, refreshRes, loginRes } = await collectIssuingResponses(app)

    for (const res of [signupRes, refreshRes, loginRes]) {
      for (const header of authCookieHeaders(res)) {
        const attributes = attributesOf(header)
        expect(attributes.get('samesite')).toBe('Lax')
        expect(attributes.has('secure')).toBe(false)
        expect(attributes.has('httponly')).toBe(true)
        expect(attributes.get('path')).toBe('/')
      }
    }
  })

  it.each([true, false])(
    'clears with attributes a browser will actually match (cookieSecure: %s)',
    async cookieSecure => {
      // A clear that differs in SameSite/Secure/Path from the set is a DIFFERENT
      // cookie to the browser: the response looks like a logout, the session lives on.
      const { app } = buildHarness({ cookieSecure })
      const { agent, res: signupRes } = await signUp(app)

      const logoutRes = await agent.post('/api/auth/logout')

      for (const name of COOKIES) {
        const setHeader = authCookieHeaders(signupRes).find(h => h.startsWith(`${name}=`)) ?? ''
        const clearHeader = authCookieHeaders(logoutRes).find(h => h.startsWith(`${name}=`)) ?? ''
        expect(setHeader).not.toBe('')
        expect(clearHeader).not.toBe('')

        // Compare the identifying attributes only — expiry legitimately differs.
        const identifying = (header: string) => {
          const attributes = attributesOf(header)
          return {
            path: attributes.get('path'),
            sameSite: attributes.get('samesite'),
            secure: attributes.has('secure'),
            httpOnly: attributes.has('httponly'),
            domain: attributes.get('domain')
          }
        }

        expect(identifying(clearHeader)).toEqual(identifying(setHeader))
      }
    }
  )

  it('does not leak a token value into the cleared cookie', async () => {
    const { app } = buildHarness({ cookieSecure: true })
    const { agent } = await signUp(app)

    const logoutRes = await agent.post('/api/auth/logout')

    for (const header of authCookieHeaders(logoutRes)) {
      const value = header.split(';')[0]?.split('=')[1] ?? ''
      expect(value).toBe('')
    }
  })
})
