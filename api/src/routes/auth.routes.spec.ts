import { describe, expect, it } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import {
  ACCESS_SECRET,
  PASSWORD,
  REFRESH_SECRET,
  agentFor,
  buildHarness,
  cookieHeader,
  cookieValue,
  signUp
} from '../test/app-harness.js'
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from '../utils/auth-cookie.js'

describe('POST /api/auth/signup', () => {
  it('creates the account, returns the public user, and sets both auth cookies', async () => {
    const { app } = buildHarness()

    const { res } = await signUp(app)

    expect(res.status).toBe(201)
    expect(res.body.user).toEqual({
      id: expect.any(String),
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      avatarUrl: null
    })
    expect(cookieHeader(res, ACCESS_TOKEN_COOKIE)).toBeDefined()
    expect(cookieHeader(res, REFRESH_TOKEN_COOKIE)).toBeDefined()
  })

  it('never returns a password, hash, or token in the response body', async () => {
    const { app } = buildHarness()

    const { res } = await signUp(app)

    const serialized = JSON.stringify(res.body)
    expect(serialized).not.toContain(PASSWORD)
    expect(serialized).not.toContain('passwordHash')
    expect(serialized).not.toContain('Token')
  })

  it('marks the cookies HttpOnly and SameSite=Lax, and leaves Secure off outside production', async () => {
    const { app } = buildHarness()

    const { res } = await signUp(app)

    for (const name of [ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE]) {
      const cookie = cookieHeader(res, name) ?? ''
      expect(cookie).toContain('HttpOnly')
      expect(cookie).toContain('SameSite=Lax')
      expect(cookie).not.toContain('Secure')
    }
  })

  it('marks the cookies SameSite=None and Secure in production, so they cross origins', async () => {
    // The deployed frontend (GitHub Pages) and api/ are on different origins, so
    // a Lax cookie would never be sent and every guarded request would 401.
    const { app } = buildHarness({ cookieSecure: true })

    const { res } = await signUp(app)

    for (const name of [ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE]) {
      const cookie = cookieHeader(res, name) ?? ''
      expect(cookie).toContain('HttpOnly')
      expect(cookie).toContain('SameSite=None')
      expect(cookie).toContain('Secure')
    }
  })

  it('rejects a second signup with the same email as 409 EMAIL_TAKEN', async () => {
    const { app } = buildHarness()
    await signUp(app)

    const { res } = await signUp(app, { name: 'Impostor' })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('EMAIL_TAKEN')
  })

  it('treats email uniqueness as case-insensitive', async () => {
    const { app } = buildHarness()
    await signUp(app, { email: 'ada@example.com' })

    const { res } = await signUp(app, { email: 'ADA@Example.com' })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('EMAIL_TAKEN')
  })

  it('rejects a malformed email with a 400', async () => {
    const { app } = buildHarness()

    const { res } = await signUp(app, { email: 'not-an-email' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('rejects a password shorter than the minimum with a 400', async () => {
    const { app } = buildHarness()

    const { res } = await signUp(app, { password: 'short' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('rejects unexpected fields in the body', async () => {
    const { app } = buildHarness()

    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'ada@example.com', name: 'Ada', password: PASSWORD, org: 'other-org' })

    expect(res.status).toBe(400)
  })
})

describe('POST /api/auth/login', () => {
  it('returns the user and fresh cookies for correct credentials', async () => {
    const { app } = buildHarness()
    await signUp(app)

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ada@example.com', password: PASSWORD })

    expect(res.status).toBe(200)
    expect(res.body.user.email).toBe('ada@example.com')
    expect(cookieHeader(res, ACCESS_TOKEN_COOKIE)).toBeDefined()
  })

  it('rejects a wrong password with 401 INVALID_CREDENTIALS', async () => {
    const { app } = buildHarness()
    await signUp(app)

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ada@example.com', password: 'wrong-password' })

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS')
    expect(cookieHeader(res, ACCESS_TOKEN_COOKIE)).toBeUndefined()
  })

  it('answers an unknown email identically to a wrong password, revealing nothing', async () => {
    const { app } = buildHarness()
    await signUp(app)

    const unknown = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: PASSWORD })
    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ada@example.com', password: 'wrong-password' })

    expect(unknown.status).toBe(401)
    expect(unknown.body.error).toEqual(wrongPassword.body.error)
  })
})

describe('POST /api/auth/logout', () => {
  it('returns 204 and clears both cookies', async () => {
    const { app } = buildHarness()
    const { agent } = await signUp(app)

    const res = await agent.post('/api/auth/logout')

    expect(res.status).toBe(204)
    expect(cookieHeader(res, ACCESS_TOKEN_COOKIE)).toContain('Expires=Thu, 01 Jan 1970')
    expect(cookieHeader(res, REFRESH_TOKEN_COOKIE)).toContain('Expires=Thu, 01 Jan 1970')
  })

  it('clears with the same SameSite/Secure attributes it set, in both environments', async () => {
    // A clear whose attributes differ from the original set targets a different
    // cookie as far as the browser is concerned, so logout would not log out.
    for (const [cookieSecure, expected] of [
      [false, 'SameSite=Lax'],
      [true, 'SameSite=None']
    ] as const) {
      const { app } = buildHarness({ cookieSecure })
      const { agent } = await signUp(app)

      const res = await agent.post('/api/auth/logout')

      for (const name of [ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE]) {
        const cookie = cookieHeader(res, name) ?? ''
        expect(cookie).toContain(expected)
        expect(cookie.includes('Secure')).toBe(cookieSecure)
      }
    }
  })

  it('revokes the session so a replayed refresh token no longer works', async () => {
    const { app } = buildHarness()
    const { agent, res: signupRes } = await signUp(app)
    const stolenRefresh = cookieValue(signupRes, REFRESH_TOKEN_COOKIE)

    await agent.post('/api/auth/logout')

    const replay = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `${REFRESH_TOKEN_COOKIE}=${stolenRefresh}`)

    expect(replay.status).toBe(401)
    expect(replay.body.error.code).toBe('UNAUTHENTICATED')
  })

  it('marks the session row revoked rather than deleting it', async () => {
    const { app, sessionRepository } = buildHarness()
    const { agent } = await signUp(app)

    await agent.post('/api/auth/logout')

    expect(sessionRepository.rows).toHaveLength(1)
    expect(sessionRepository.rows[0].revokedAt).toBeInstanceOf(Date)
  })

  it('succeeds for a caller with no cookies at all', async () => {
    const { app } = buildHarness()

    const res = await request(app).post('/api/auth/logout')

    expect(res.status).toBe(204)
  })
})

describe('POST /api/auth/refresh', () => {
  it('issues a new token pair for a valid refresh cookie', async () => {
    const { app } = buildHarness()
    const { agent } = await signUp(app)

    const res = await agent.post('/api/auth/refresh')

    expect(res.status).toBe(200)
    expect(res.body.user.email).toBe('ada@example.com')
    expect(cookieHeader(res, ACCESS_TOKEN_COOKIE)).toBeDefined()
    expect(cookieHeader(res, REFRESH_TOKEN_COOKIE)).toBeDefined()
  })

  it('rotates the session: the refresh token it replaced stops working', async () => {
    const { app } = buildHarness()
    const { agent, res: signupRes } = await signUp(app)
    const firstRefresh = cookieValue(signupRes, REFRESH_TOKEN_COOKIE)

    await agent.post('/api/auth/refresh')
    const replay = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `${REFRESH_TOKEN_COOKIE}=${firstRefresh}`)

    expect(replay.status).toBe(401)
  })

  it('rejects a request with no refresh cookie', async () => {
    const { app } = buildHarness()

    const res = await request(app).post('/api/auth/refresh')

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
  })

  it('rejects an expired refresh JWT', async () => {
    const { app } = buildHarness()
    const { res: signupRes } = await signUp(app)
    const live = jwt.verify(
      cookieValue(signupRes, REFRESH_TOKEN_COOKIE) ?? '',
      REFRESH_SECRET
    ) as jwt.JwtPayload
    const expired = jwt.sign({ org: live.org, sid: live.sid }, REFRESH_SECRET, {
      subject: live.sub,
      expiresIn: -60
    })

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `${REFRESH_TOKEN_COOKIE}=${expired}`)

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
  })

  it('rejects a token whose session row has expired, even when the JWT has not', async () => {
    const { app, sessionRepository } = buildHarness()
    const { agent } = await signUp(app)
    sessionRepository.rows[0].expiresAt = new Date(Date.now() - 1000)

    const res = await agent.post('/api/auth/refresh')

    expect(res.status).toBe(401)
  })

  it('rejects a refresh token signed with the access secret', async () => {
    const { app } = buildHarness()
    const { res: signupRes } = await signUp(app)
    const live = jwt.verify(
      cookieValue(signupRes, REFRESH_TOKEN_COOKIE) ?? '',
      REFRESH_SECRET
    ) as jwt.JwtPayload
    const forged = jwt.sign({ org: live.org, sid: live.sid }, ACCESS_SECRET, { subject: live.sub })

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `${REFRESH_TOKEN_COOKIE}=${forged}`)

    expect(res.status).toBe(401)
  })

  it('clears the stale cookies when the refresh is rejected', async () => {
    const { app } = buildHarness()

    const res = await agentFor(app)
      .post('/api/auth/refresh')
      .set('Cookie', `${REFRESH_TOKEN_COOKIE}=garbage`)

    expect(res.status).toBe(401)
    expect(cookieHeader(res, REFRESH_TOKEN_COOKIE)).toContain('Expires=Thu, 01 Jan 1970')
  })
})
