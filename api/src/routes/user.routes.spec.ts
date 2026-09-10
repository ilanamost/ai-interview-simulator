import { describe, expect, it } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { ACCESS_SECRET, PASSWORD, buildHarness, cookieValue, signUp } from '../test/app-harness.js'
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from '../utils/auth-cookie.js'

const TINY_AVATAR = 'data:image/png;base64,iVBORw0KGgo='

/** Just past the 2MB pre-encoding cap once decoded. */
const OVERSIZED_AVATAR = `data:image/png;base64,${'A'.repeat(2796208)}`

describe('GET /api/user', () => {
  it('returns the authenticated user', async () => {
    const { app } = buildHarness()
    const { agent } = await signUp(app)

    const res = await agent.get('/api/user')

    expect(res.status).toBe(200)
    expect(res.body.user).toEqual({
      id: expect.any(String),
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      avatarUrl: null
    })
  })

  it('rejects a request with no access cookie', async () => {
    const { app } = buildHarness()

    const res = await request(app).get('/api/user')

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
  })

  it('rejects a malformed access cookie', async () => {
    const { app } = buildHarness()

    const res = await request(app).get('/api/user').set('Cookie', `${ACCESS_TOKEN_COOKIE}=garbage`)

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
  })

  it('rejects an expired access token', async () => {
    const { app } = buildHarness()
    await signUp(app)
    const expired = jwt.sign({ org: 'default', sid: 'session-1' }, ACCESS_SECRET, {
      subject: 'user-1',
      expiresIn: -60
    })

    const res = await request(app)
      .get('/api/user')
      .set('Cookie', `${ACCESS_TOKEN_COOKIE}=${expired}`)

    expect(res.status).toBe(401)
  })

  it('rejects an access token signed with the refresh secret', async () => {
    const { app } = buildHarness()
    const { res: signupRes } = await signUp(app)
    const refresh = cookieValue(signupRes, REFRESH_TOKEN_COOKIE) ?? ''

    const res = await request(app)
      .get('/api/user')
      .set('Cookie', `${ACCESS_TOKEN_COOKIE}=${refresh}`)

    expect(res.status).toBe(401)
  })
})

describe('PATCH /api/user', () => {
  it('updates the name and returns the updated user', async () => {
    const { app } = buildHarness()
    const { agent } = await signUp(app)

    const res = await agent.patch('/api/user').send({ name: 'Ada L.' })

    expect(res.status).toBe(200)
    expect(res.body.user.name).toBe('Ada L.')
  })

  it('stores an avatar data URL and returns it on the user', async () => {
    const { app } = buildHarness()
    const { agent } = await signUp(app)

    const res = await agent.patch('/api/user').send({ avatarUrl: TINY_AVATAR })

    expect(res.status).toBe(200)
    expect(res.body.user.avatarUrl).toBe(TINY_AVATAR)
  })

  it('clears the avatar when sent null', async () => {
    const { app } = buildHarness()
    const { agent } = await signUp(app)
    await agent.patch('/api/user').send({ avatarUrl: TINY_AVATAR })

    const res = await agent.patch('/api/user').send({ avatarUrl: null })

    expect(res.status).toBe(200)
    expect(res.body.user.avatarUrl).toBeNull()
  })

  it('rejects an avatar over the 2MB cap with a 400', async () => {
    const { app } = buildHarness()
    const { agent } = await signUp(app)

    const res = await agent.patch('/api/user').send({ avatarUrl: OVERSIZED_AVATAR })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('rejects an avatar that is not an image data URL', async () => {
    const { app } = buildHarness()
    const { agent } = await signUp(app)

    const res = await agent.patch('/api/user').send({ avatarUrl: 'https://example.com/me.png' })

    expect(res.status).toBe(400)
  })

  it('rejects an email already used by another account with a 409', async () => {
    const { app } = buildHarness()
    await signUp(app, { email: 'grace@example.com' })
    const { agent } = await signUp(app, { email: 'ada@example.com' })

    const res = await agent.patch('/api/user').send({ email: 'grace@example.com' })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('EMAIL_TAKEN')
  })

  it('allows re-saving the caller own email unchanged', async () => {
    const { app } = buildHarness()
    const { agent } = await signUp(app)

    const res = await agent.patch('/api/user').send({ email: 'ada@example.com' })

    expect(res.status).toBe(200)
    expect(res.body.user.email).toBe('ada@example.com')
  })

  it('rejects a password change that omits currentPassword', async () => {
    const { app } = buildHarness()
    const { agent } = await signUp(app)

    const res = await agent.patch('/api/user').send({ password: 'a-brand-new-password' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('rejects a password change whose currentPassword is wrong', async () => {
    const { app } = buildHarness()
    const { agent } = await signUp(app)

    const res = await agent
      .patch('/api/user')
      .send({ password: 'a-brand-new-password', currentPassword: 'not-my-password' })

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS')
  })

  it('changes the password so the old one stops working and the new one works', async () => {
    const { app } = buildHarness()
    const { agent } = await signUp(app)

    const patched = await agent
      .patch('/api/user')
      .send({ password: 'a-brand-new-password', currentPassword: PASSWORD })
    const oldLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ada@example.com', password: PASSWORD })
    const newLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ada@example.com', password: 'a-brand-new-password' })

    expect(patched.status).toBe(200)
    expect(oldLogin.status).toBe(401)
    expect(newLogin.status).toBe(200)
  })

  it('revokes every other session on a password change but keeps the caller signed in', async () => {
    const { app } = buildHarness()
    const { agent } = await signUp(app)
    // A second device signs in, then the first device changes the password.
    const otherDevice = request.agent(app)
    await otherDevice.post('/api/auth/login').send({ email: 'ada@example.com', password: PASSWORD })

    await agent
      .patch('/api/user')
      .send({ password: 'a-brand-new-password', currentPassword: PASSWORD })

    const stillSignedIn = await agent.get('/api/user')
    const otherDeviceRefresh = await otherDevice.post('/api/auth/refresh')
    expect(stillSignedIn.status).toBe(200)
    expect(otherDeviceRefresh.status).toBe(401)
  })

  it('rejects an empty body', async () => {
    const { app } = buildHarness()
    const { agent } = await signUp(app)

    const res = await agent.patch('/api/user').send({})

    expect(res.status).toBe(400)
  })

  it('rejects unexpected fields, including any attempt to set org or id', async () => {
    const { app } = buildHarness()
    const { agent } = await signUp(app)

    const res = await agent.patch('/api/user').send({ name: 'Ada', org: 'other-org' })

    expect(res.status).toBe(400)
  })

  it('rejects a request with no access cookie', async () => {
    const { app } = buildHarness()

    const res = await request(app).patch('/api/user').send({ name: 'Ada' })

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
  })
})
