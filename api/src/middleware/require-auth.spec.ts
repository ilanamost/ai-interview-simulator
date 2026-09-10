import { describe, expect, it } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import {
  ACCESS_SECRET,
  PASSWORD,
  agentFor,
  buildHarness,
  cookieValue,
  signUp
} from '../test/app-harness.js'
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from '../utils/auth-cookie.js'

/**
 * Regression cover for QA finding F1: verifying the access JWT's signature and expiry
 * is not enough. The `user_session` row it names has to still be live, or logout and
 * password-change revocation would not take effect until the token expired
 * (.rule/security-rules.md: "invalidate sessions/tokens on logout, password change").
 *
 * A stolen cookie is the threat these tests describe — a browser drops its own cookies
 * on logout, so every one of them replays a copied `access_token` by hand.
 */

const cookie = (name: string, value: string) => `${name}=${value}`

describe('require-auth session revocation', () => {
  it('rejects a logged-out session access token immediately, not at expiry', async () => {
    const { app } = buildHarness()
    const { agent, res } = await signUp(app)
    const access = cookieValue(res, ACCESS_TOKEN_COOKIE) as string

    await agent.post('/api/auth/logout').send({}).expect(204)
    const replay = await request(app)
      .get('/api/user')
      .set('Cookie', cookie(ACCESS_TOKEN_COOKIE, access))

    expect(replay.status).toBe(401)
    expect(replay.body.error.code).toBe('UNAUTHENTICATED')
  })

  it('keeps that logged-out token away from /api/interview, and off the service', async () => {
    const { app, interviewService } = buildHarness()
    const { agent, res } = await signUp(app)
    const access = cookieValue(res, ACCESS_TOKEN_COOKIE) as string

    await agent.post('/api/auth/logout').send({}).expect(204)
    const replay = await request(app)
      .get('/api/interview/interview-1')
      .set('Cookie', cookie(ACCESS_TOKEN_COOKIE, access))

    expect(replay.status).toBe(401)
    expect(interviewService.getInterview).not.toHaveBeenCalled()
  })

  it('kills another device access token on a password change, not just its refresh token', async () => {
    const { app } = buildHarness()
    const { agent: deviceA } = await signUp(app)
    const deviceB = agentFor(app)
    const loginB = await deviceB
      .post('/api/auth/login')
      .send({ email: 'ada@example.com', password: PASSWORD })
      .expect(200)
    const accessB = cookieValue(loginB, ACCESS_TOKEN_COOKIE) as string
    const refreshB = cookieValue(loginB, REFRESH_TOKEN_COOKIE) as string

    await deviceA
      .patch('/api/user')
      .send({ password: 'a-brand-new-password', currentPassword: PASSWORD })
      .expect(200)

    const refreshed = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookie(REFRESH_TOKEN_COOKIE, refreshB))
      .send({})
    const guarded = await request(app)
      .get('/api/user')
      .set('Cookie', cookie(ACCESS_TOKEN_COOKIE, accessB))

    expect(refreshed.status).toBe(401)
    expect(guarded.status).toBe(401)
    expect(guarded.body.error.code).toBe('UNAUTHENTICATED')
  })

  it('leaves the device that changed the password signed in', async () => {
    const { app } = buildHarness()
    const { agent } = await signUp(app)

    await agent
      .patch('/api/user')
      .send({ password: 'a-brand-new-password', currentPassword: PASSWORD })
      .expect(200)

    await agent.get('/api/user').expect(200)
  })

  it('rejects a well-signed token naming a session that never existed', async () => {
    const { app } = buildHarness()
    await signUp(app)
    const forged = jwt.sign({ org: 'default', sid: 'no-such-session' }, ACCESS_SECRET, {
      subject: 'ada',
      expiresIn: 900
    })

    const res = await request(app)
      .get('/api/user')
      .set('Cookie', cookie(ACCESS_TOKEN_COOKIE, forged))

    expect(res.status).toBe(401)
  })

  it('rejects a token whose sid belongs to a different user than its sub', async () => {
    const { app, sessionRepository } = buildHarness()
    await signUp(app)
    const hijacked = jwt.sign(
      { org: 'default', sid: sessionRepository.rows[0].id },
      ACCESS_SECRET,
      { subject: 'someone-else', expiresIn: 900 }
    )

    const res = await request(app)
      .get('/api/user')
      .set('Cookie', cookie(ACCESS_TOKEN_COOKIE, hijacked))

    expect(res.status).toBe(401)
  })

  it('retires the pre-rotation access token after a refresh', async () => {
    const { app } = buildHarness()
    const { agent, res: signupRes } = await signUp(app)
    const oldAccess = cookieValue(signupRes, ACCESS_TOKEN_COOKIE) as string

    // Rotation revokes the old session, so its access token goes with it. The client
    // is not stranded: the same response hands it a new pair.
    const rotated = await agent.post('/api/auth/refresh').send({}).expect(200)
    const replay = await request(app)
      .get('/api/user')
      .set('Cookie', cookie(ACCESS_TOKEN_COOKIE, oldAccess))

    expect(cookieValue(rotated, ACCESS_TOKEN_COOKIE)).not.toBe(oldAccess)
    expect(replay.status).toBe(401)
    await agent.get('/api/user').expect(200)
  })

  it('still admits a live session, so the check is not simply refusing everyone', async () => {
    const { app } = buildHarness()
    const { agent } = await signUp(app)

    await agent.get('/api/user').expect(200)
    await agent.get('/api/user').expect(200)
  })

  it('answers a revoked session with the same code as a missing cookie, leaking nothing', async () => {
    const { app } = buildHarness()
    const { agent, res } = await signUp(app)
    const access = cookieValue(res, ACCESS_TOKEN_COOKIE) as string
    await agent.post('/api/auth/logout').send({}).expect(204)

    const revoked = await request(app)
      .get('/api/user')
      .set('Cookie', cookie(ACCESS_TOKEN_COOKIE, access))
    const missing = await request(app).get('/api/user')

    expect(revoked.status).toBe(missing.status)
    expect(revoked.body.error.code).toBe(missing.body.error.code)
  })

  it('rejects an org-a token against an org-b deployment, reaching no service', async () => {
    const { app: appA } = buildHarness({ org: 'org-a' })
    const { res } = await signUp(appA)
    const orgAToken = cookieValue(res, ACCESS_TOKEN_COOKIE) as string
    const { app: appB, interviewService } = buildHarness({ org: 'org-b' })

    // Same test secrets, so the signature verifies — org-b holds the line because the
    // token names no session it knows.
    const attempt = await request(appB)
      .get('/api/interview/interview-1')
      .set('Cookie', cookie(ACCESS_TOKEN_COOKIE, orgAToken))

    expect(attempt.status).toBe(401)
    expect(interviewService.getInterview).not.toHaveBeenCalled()
  })
})
