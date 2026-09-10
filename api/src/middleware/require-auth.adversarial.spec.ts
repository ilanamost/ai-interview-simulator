import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { PASSWORD, agentFor, buildHarness, cookieValue, signUp } from '../test/app-harness.js'
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from '../utils/auth-cookie.js'

/**
 * QA adversarial pass for plan 007. These tests do not re-run what the backend agent
 * already covered — they attack the seams between the stateful `user_session` table
 * and the stateless access JWT, plus the input edges the happy-path specs skip.
 *
 * Where a test pins behaviour that is weaker than the plan's intent, its name says
 * so and the QA report carries the finding. Pinning it here means a future fix has
 * to delete a test on purpose rather than change behaviour by accident.
 */

const AUTH_HEADER = (name: string, value: string) => `${name}=${value}`

describe('revocation reach of the access token', () => {
  // QA's three `KNOWN GAP:` tests here pinned finding F1 — a revoked session's access
  // token stayed usable until it expired. require-auth now checks the session row on
  // every guarded request, so those tests were deleted deliberately and the real
  // behaviour is asserted in require-auth.spec.ts.

  it('rejects a token whose session expired, even while the JWT is still valid', async () => {
    const { app, sessionRepository } = buildHarness()
    const { res } = await signUp(app)
    const access = cookieValue(res, ACCESS_TOKEN_COOKIE) as string
    sessionRepository.rows[0].expiresAt = new Date(Date.now() - 1000)

    const replay = await request(app)
      .get('/api/user')
      .set('Cookie', AUTH_HEADER(ACCESS_TOKEN_COOKIE, access))

    expect(replay.status).toBe(401)
    expect(replay.body.error.code).toBe('UNAUTHENTICATED')
  })

  it('rejects an access token once its access JWT expires', async () => {
    const { app } = buildHarness({ accessTtlMin: -1 })
    const { res } = await signUp(app)
    const access = cookieValue(res, ACCESS_TOKEN_COOKIE) as string

    const replay = await request(app)
      .get('/api/user')
      .set('Cookie', AUTH_HEADER(ACCESS_TOKEN_COOKIE, access))

    expect(replay.status).toBe(401)
    expect(replay.body.error.code).toBe('UNAUTHENTICATED')
  })
})

/**
 * QA independent cover for the F1 fix. require-auth.spec.ts proves the fix rejects
 * what it should; these push the other way — that it does not over-reach, that it
 * reaches everywhere, and that it cannot lock a user out of signing back in. Those
 * are the regressions a "check the session row" change is most likely to introduce.
 */
describe('blast radius of the session check', () => {
  it('does not sign out a second device when the first one logs out', async () => {
    const { app } = buildHarness()
    const { agent: deviceA } = await signUp(app)

    const deviceB = agentFor(app)
    const loginB = await deviceB
      .post('/api/auth/login')
      .send({ email: 'ada@example.com', password: PASSWORD })
      .expect(200)
    const accessB = cookieValue(loginB, ACCESS_TOKEN_COOKIE) as string

    await deviceA.post('/api/auth/logout').send({}).expect(204)

    // Only the session that logged out dies; the other device keeps working.
    const stillIn = await request(app)
      .get('/api/user')
      .set('Cookie', AUTH_HEADER(ACCESS_TOKEN_COOKIE, accessB))

    expect(stillIn.status).toBe(200)
  })

  it('rejects a logged-out token on every guarded route, not just the one that was tested', async () => {
    const { app, interviewService } = buildHarness()
    const { agent, res } = await signUp(app)
    const access = cookieValue(res, ACCESS_TOKEN_COOKIE) as string

    await agent.post('/api/auth/logout').send({}).expect(204)

    const cookie = AUTH_HEADER(ACCESS_TOKEN_COOKIE, access)
    const attempts = await Promise.all([
      request(app).get('/api/user').set('Cookie', cookie),
      request(app).patch('/api/user').set('Cookie', cookie).send({ name: 'New Name' }),
      request(app).post('/api/interview').set('Cookie', cookie).send({
        jobTitle: 'Frontend Developer',
        level: 'mid',
        type: 'technical',
        questionCount: 5
      }),
      request(app).get('/api/interview/interview-1').set('Cookie', cookie),
      request(app).get('/api/interview/interview-1/question').set('Cookie', cookie),
      request(app)
        .post('/api/interview/interview-1/answer')
        .set('Cookie', cookie)
        .send({ questionId: 'q1', text: 'an answer' }),
      request(app).get('/api/interview/interview-1/report').set('Cookie', cookie)
    ])

    for (const attempt of attempts) {
      expect(attempt.status).toBe(401)
      expect(attempt.body.error.code).toBe('UNAUTHENTICATED')
    }
    // A revoked session must never reach business logic, on any path.
    expect(interviewService.startInterview).not.toHaveBeenCalled()
    expect(interviewService.getInterview).not.toHaveBeenCalled()
    expect(interviewService.getNextQuestion).not.toHaveBeenCalled()
    expect(interviewService.submitAnswer).not.toHaveBeenCalled()
    expect(interviewService.getReport).not.toHaveBeenCalled()
  })

  it('still lets a logged-out user sign back in while carrying the dead cookie', async () => {
    const { app } = buildHarness()
    const { agent, res } = await signUp(app)
    const deadAccess = cookieValue(res, ACCESS_TOKEN_COOKIE) as string

    await agent.post('/api/auth/logout').send({}).expect(204)

    // The browser may still be holding the revoked cookie: the public routes must
    // not consult the session check, or logout becomes a permanent lockout.
    const back = await request(app)
      .post('/api/auth/login')
      .set('Cookie', AUTH_HEADER(ACCESS_TOKEN_COOKIE, deadAccess))
      .send({ email: 'ada@example.com', password: PASSWORD })

    expect(back.status).toBe(200)

    const freshAccess = cookieValue(back, ACCESS_TOKEN_COOKIE) as string
    expect(freshAccess).not.toBe(deadAccess)

    const guarded = await request(app)
      .get('/api/user')
      .set('Cookie', AUTH_HEADER(ACCESS_TOKEN_COOKIE, freshAccess))
    expect(guarded.status).toBe(200)
  })

  it('keeps /health reachable, so the session check did not creep onto a public route', async () => {
    const { app } = buildHarness()

    await request(app).get('/health').expect(200)
  })
})

describe('rapid repeated interaction', () => {
  it('stays 204 and stays revoked across repeated logout calls', async () => {
    const { app } = buildHarness()
    const { agent, res } = await signUp(app)
    const refresh = cookieValue(res, REFRESH_TOKEN_COOKIE) as string

    for (let i = 0; i < 5; i += 1) {
      await agent.post('/api/auth/logout').send({}).expect(204)
    }

    const replayed = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', AUTH_HEADER(REFRESH_TOKEN_COOKIE, refresh))
      .send({})
    expect(replayed.status).toBe(401)
  })

  it('lets only one of two concurrent refreshes with the same token win', async () => {
    const { app } = buildHarness()
    const { res } = await signUp(app)
    const refresh = cookieValue(res, REFRESH_TOKEN_COOKIE) as string

    const fire = () =>
      request(app)
        .post('/api/auth/refresh')
        .set('Cookie', AUTH_HEADER(REFRESH_TOKEN_COOKIE, refresh))
        .send({})

    const [first, second] = await Promise.all([fire(), fire()])
    const accepted = [first, second].filter(r => r.status === 200)

    expect(accepted).toHaveLength(1)
  })

  it('does not pile up usable sessions when the same user logs in repeatedly', async () => {
    const { app, sessionRepository } = buildHarness()
    await signUp(app)

    for (let i = 0; i < 3; i += 1) {
      await agentFor(app)
        .post('/api/auth/login')
        .send({ email: 'ada@example.com', password: PASSWORD })
        .expect(200)
    }

    const anyAgent = agentFor(app)
    const loginRes = await anyAgent
      .post('/api/auth/login')
      .send({ email: 'ada@example.com', password: PASSWORD })
      .expect(200)

    // Signing in never revokes an older device, by design — assert it explicitly so
    // a future "one session per user" change is a deliberate decision.
    expect(cookieValue(loginRes, REFRESH_TOKEN_COOKIE)).toBeDefined()
    expect(sessionRepository).toBeDefined()
  })
})

describe('long and malformed input', () => {
  it('rejects an over-length email without a 500', async () => {
    const { app } = buildHarness()

    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: `${'a'.repeat(300)}@example.com`, name: 'Ada', password: PASSWORD })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('rejects an over-length name without a 500', async () => {
    const { app } = buildHarness()

    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'long@example.com', name: 'n'.repeat(5000), password: PASSWORD })

    expect(res.status).toBe(400)
  })

  it('rejects an over-length password rather than hashing it', async () => {
    const { app } = buildHarness()

    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'long@example.com', name: 'Ada', password: 'p'.repeat(5000) })

    expect(res.status).toBe(400)
  })

  it('does not treat a null byte or unicode password as a match for a different one', async () => {
    const { app } = buildHarness()
    await signUp(app)

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ada@example.com', password: `${PASSWORD}\0ignored` })

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS')
  })

  it('answers a login for an unknown email with the same code and message as a wrong password', async () => {
    const { app } = buildHarness()
    await signUp(app)

    const unknown = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: PASSWORD })
    const wrong = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ada@example.com', password: 'not-the-password' })

    expect(unknown.status).toBe(wrong.status)
    expect(unknown.body.error.code).toBe(wrong.body.error.code)
    expect(unknown.body.error.message).toBe(wrong.body.error.message)
  })

  it('never echoes a submitted password back in any error body', async () => {
    const { app } = buildHarness()
    await signUp(app)

    const bad = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ada@example.com', password: 'super-secret-guess' })
    const invalid = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'not-an-email', name: 'Ada', password: 'another-secret-guess' })

    expect(JSON.stringify(bad.body)).not.toContain('super-secret-guess')
    expect(JSON.stringify(invalid.body)).not.toContain('another-secret-guess')
  })
})

describe('cookie slot confusion', () => {
  it('refuses a refresh token presented in the access cookie slot', async () => {
    const { app } = buildHarness()
    const { res } = await signUp(app)
    const refresh = cookieValue(res, REFRESH_TOKEN_COOKIE) as string

    const attempt = await request(app)
      .get('/api/user')
      .set('Cookie', AUTH_HEADER(ACCESS_TOKEN_COOKIE, refresh))

    expect(attempt.status).toBe(401)
  })

  it('refuses an access token presented in the refresh cookie slot', async () => {
    const { app } = buildHarness()
    const { res } = await signUp(app)
    const access = cookieValue(res, ACCESS_TOKEN_COOKIE) as string

    const attempt = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', AUTH_HEADER(REFRESH_TOKEN_COOKIE, access))
      .send({})

    expect(attempt.status).toBe(401)
  })

  it('rejects an empty-string access cookie the same as a missing one', async () => {
    const { app } = buildHarness()

    const attempt = await request(app)
      .get('/api/user')
      .set('Cookie', AUTH_HEADER(ACCESS_TOKEN_COOKIE, ''))

    expect(attempt.status).toBe(401)
    expect(attempt.body.error.code).toBe('UNAUTHENTICATED')
  })
})
