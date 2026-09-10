import { describe, expect, it } from 'vitest'
import { createAuthService, type AuthContext } from './auth.service.js'
import { createTokenService } from './auth/token.service.js'
import type { PasswordService } from './auth/password.service.js'
import {
  createInMemorySessionRepository,
  createInMemoryUserRepository
} from '../test/in-memory-auth-repositories.js'
import { AppError } from '../utils/app-error.js'

const ORG = 'default'

/** Deterministic stand-in for bcrypt: same contract, no cost. */
const passwords: PasswordService = {
  hash: (plain: string) => Promise.resolve(`hashed:${plain}`),
  verify: (plain: string, hash: string) => Promise.resolve(hash === `hashed:${plain}`)
}

function build(options: { org?: string; now?: () => Date } = {}) {
  const userRepository = createInMemoryUserRepository()
  const sessionRepository = createInMemorySessionRepository()
  const tokens = createTokenService({
    accessSecret: 'access-secret',
    refreshSecret: 'refresh-secret',
    accessTtlMin: 15,
    refreshTtlDays: 30
  })
  let counter = 0
  const service = createAuthService({
    userRepository,
    sessionRepository,
    passwords,
    tokens,
    org: options.org ?? ORG,
    idGenerator: () => `id-${++counter}`,
    now: options.now
  })
  return { service, userRepository, sessionRepository, tokens }
}

const CREDENTIALS = { email: 'ada@example.com', name: 'Ada', password: 'a-good-password' }

async function expectAppError(promise: Promise<unknown>, status: number, code: string) {
  await expect(promise).rejects.toBeInstanceOf(AppError)
  await promise.catch((err: AppError) => {
    expect(err.status).toBe(status)
    expect(err.code).toBe(code)
  })
}

describe('auth.service signup', () => {
  it('creates the user, opens a session, and returns tokens plus the public user', async () => {
    const { service, sessionRepository } = build()

    const result = await service.signup(CREDENTIALS)

    expect(result.user).toEqual({
      id: 'id-1',
      email: 'ada@example.com',
      name: 'Ada',
      avatarUrl: null
    })
    expect(result.accessToken).toEqual(expect.any(String))
    expect(result.refreshToken).toEqual(expect.any(String))
    expect(sessionRepository.rows).toHaveLength(1)
  })

  it('stores only the hash of the password', async () => {
    const { service, userRepository } = build()

    await service.signup(CREDENTIALS)

    expect(userRepository.rows[0].passwordHash).toBe('hashed:a-good-password')
    expect(userRepository.rows[0].passwordHash).not.toContain('a-good-password'.slice(0, 6) + '$')
  })

  it('normalizes the email before storing it', async () => {
    const { service, userRepository } = build()

    await service.signup({ ...CREDENTIALS, email: '  ADA@Example.com ' })

    expect(userRepository.rows[0].email).toBe('ada@example.com')
  })

  it('lands every signup in the configured org', async () => {
    const { service, userRepository } = build({ org: 'acme' })

    await service.signup(CREDENTIALS)

    expect(userRepository.rows[0].org).toBe('acme')
  })

  it('rejects a duplicate email with 409 EMAIL_TAKEN and creates no second user', async () => {
    const { service, userRepository } = build()
    await service.signup(CREDENTIALS)

    await expectAppError(service.signup(CREDENTIALS), 409, 'EMAIL_TAKEN')
    expect(userRepository.rows).toHaveLength(1)
  })

  it('stores the refresh token as a hash, never in the clear', async () => {
    const { service, sessionRepository } = build()

    const result = await service.signup(CREDENTIALS)

    expect(sessionRepository.rows[0].refreshTokenHash).not.toBe(result.refreshToken)
    expect(sessionRepository.rows[0].refreshTokenHash).toHaveLength(64)
  })
})

describe('auth.service login', () => {
  it('returns a new session for correct credentials', async () => {
    const { service, sessionRepository } = build()
    await service.signup(CREDENTIALS)

    const result = await service.login({ email: CREDENTIALS.email, password: CREDENTIALS.password })

    expect(result.user.email).toBe('ada@example.com')
    expect(sessionRepository.rows).toHaveLength(2)
  })

  it('accepts a differently-cased email', async () => {
    const { service } = build()
    await service.signup(CREDENTIALS)

    await expect(
      service.login({ email: 'ADA@example.COM', password: CREDENTIALS.password })
    ).resolves.toMatchObject({ user: { email: 'ada@example.com' } })
  })

  it('rejects a wrong password with 401 INVALID_CREDENTIALS', async () => {
    const { service } = build()
    await service.signup(CREDENTIALS)

    await expectAppError(
      service.login({ email: CREDENTIALS.email, password: 'nope' }),
      401,
      'INVALID_CREDENTIALS'
    )
  })

  it('rejects an unknown email with the identical error, revealing no account existence', async () => {
    const { service } = build()
    await service.signup(CREDENTIALS)

    const unknown = (await service
      .login({ email: 'nobody@example.com', password: CREDENTIALS.password })
      .catch((err: AppError) => err)) as AppError
    const wrongPassword = (await service
      .login({ email: CREDENTIALS.email, password: 'nope' })
      .catch((err: AppError) => err)) as AppError

    expect(unknown.code).toBe(wrongPassword.code)
    expect(unknown.message).toBe(wrongPassword.message)
  })

  it('never signs in a user from another org', async () => {
    const { service, userRepository } = build({ org: 'org-a' })
    await service.signup(CREDENTIALS)
    userRepository.rows[0].org = 'org-b'

    await expectAppError(
      service.login({ email: CREDENTIALS.email, password: CREDENTIALS.password }),
      401,
      'INVALID_CREDENTIALS'
    )
  })
})

describe('auth.service refresh', () => {
  it('rotates the session, revoking the presented one', async () => {
    const { service, sessionRepository } = build()
    const first = await service.signup(CREDENTIALS)

    const second = await service.refresh(first.refreshToken)

    expect(sessionRepository.rows[0].revokedAt).toBeInstanceOf(Date)
    expect(sessionRepository.rows[1].revokedAt).toBeNull()
    expect(second.refreshToken).not.toBe(first.refreshToken)
  })

  it('rejects a token that has already been rotated away', async () => {
    const { service } = build()
    const first = await service.signup(CREDENTIALS)
    await service.refresh(first.refreshToken)

    await expectAppError(service.refresh(first.refreshToken), 401, 'UNAUTHENTICATED')
  })

  it('rejects a missing token', async () => {
    const { service } = build()

    await expectAppError(service.refresh(undefined), 401, 'UNAUTHENTICATED')
  })

  it('rejects a token whose session row has expired', async () => {
    const { service, sessionRepository } = build()
    const first = await service.signup(CREDENTIALS)
    sessionRepository.rows[0].expiresAt = new Date(Date.now() - 1)

    await expectAppError(service.refresh(first.refreshToken), 401, 'UNAUTHENTICATED')
  })

  it('rejects a valid signature whose stored hash no longer matches', async () => {
    const { service, sessionRepository } = build()
    const first = await service.signup(CREDENTIALS)
    sessionRepository.rows[0].refreshTokenHash = 'a-different-hash'

    await expectAppError(service.refresh(first.refreshToken), 401, 'UNAUTHENTICATED')
  })

  it('rejects a token minted for a different org', async () => {
    const { tokens } = build()
    const { service } = build({ org: 'org-b' })
    const foreign = tokens.signRefreshToken({ userId: 'u1', org: 'org-a', sessionId: 's1' })

    await expectAppError(service.refresh(foreign), 401, 'UNAUTHENTICATED')
  })
})

describe('auth.service logout', () => {
  it('revokes the session named by the refresh token', async () => {
    const { service, sessionRepository } = build()
    const { refreshToken } = await service.signup(CREDENTIALS)

    await service.logout({ refreshToken })

    expect(sessionRepository.rows[0].revokedAt).toBeInstanceOf(Date)
  })

  it('falls back to the access token when only that cookie survived', async () => {
    const { service, sessionRepository } = build()
    const { accessToken } = await service.signup(CREDENTIALS)

    await service.logout({ accessToken })

    expect(sessionRepository.rows[0].revokedAt).toBeInstanceOf(Date)
  })

  it('is a no-op, not an error, when no usable token is present', async () => {
    const { service, sessionRepository } = build()
    await service.signup(CREDENTIALS)

    await expect(service.logout({ refreshToken: 'garbage' })).resolves.toBeUndefined()
    expect(sessionRepository.rows[0].revokedAt).toBeNull()
  })
})

describe('auth.service profile', () => {
  async function signedIn() {
    const built = build()
    const result = await built.service.signup(CREDENTIALS)
    const ctx: AuthContext = {
      userId: result.user.id,
      org: ORG,
      sessionId: built.sessionRepository.rows[0].id
    }
    return { ...built, ctx }
  }

  it('returns the current user without any hash', async () => {
    const { service, ctx } = await signedIn()

    const user = await service.getCurrentUser(ctx)

    expect(user).toEqual({
      id: ctx.userId,
      email: 'ada@example.com',
      name: 'Ada',
      avatarUrl: null
    })
    expect(Object.keys(user)).not.toContain('passwordHash')
  })

  it('rejects a token for a user that no longer exists', async () => {
    const { service, ctx, userRepository } = await signedIn()
    userRepository.rows.length = 0

    await expectAppError(service.getCurrentUser(ctx), 401, 'UNAUTHENTICATED')
  })

  it('updates name and avatar', async () => {
    const { service, ctx } = await signedIn()

    const user = await service.updateProfile(ctx, {
      name: 'Ada L.',
      avatarUrl: 'data:image/png;base64,AA=='
    })

    expect(user.name).toBe('Ada L.')
    expect(user.avatarUrl).toBe('data:image/png;base64,AA==')
  })

  it('normalizes a changed email', async () => {
    const { service, ctx } = await signedIn()

    const user = await service.updateProfile(ctx, { email: ' NewAda@Example.com ' })

    expect(user.email).toBe('newada@example.com')
  })

  it('rejects an email another account already owns', async () => {
    const { service, ctx } = await signedIn()
    await service.signup({ ...CREDENTIALS, email: 'grace@example.com' })

    await expectAppError(
      service.updateProfile(ctx, { email: 'grace@example.com' }),
      409,
      'EMAIL_TAKEN'
    )
  })

  it('rejects a password change without the correct current password', async () => {
    const { service, ctx } = await signedIn()

    await expectAppError(
      service.updateProfile(ctx, { password: 'a-fresh-password', currentPassword: 'wrong' }),
      401,
      'INVALID_CREDENTIALS'
    )
  })

  it('revokes every other session on a password change, sparing the caller', async () => {
    const { service, ctx, sessionRepository } = await signedIn()
    await service.login({ email: CREDENTIALS.email, password: CREDENTIALS.password })
    await service.login({ email: CREDENTIALS.email, password: CREDENTIALS.password })

    await service.updateProfile(ctx, {
      password: 'a-fresh-password',
      currentPassword: CREDENTIALS.password
    })

    const [caller, ...others] = sessionRepository.rows
    expect(caller.id).toBe(ctx.sessionId)
    expect(caller.revokedAt).toBeNull()
    expect(others.every(row => row.revokedAt instanceof Date)).toBe(true)
  })

  it('leaves other sessions alone when the password is not part of the update', async () => {
    const { service, ctx, sessionRepository } = await signedIn()
    await service.login({ email: CREDENTIALS.email, password: CREDENTIALS.password })

    await service.updateProfile(ctx, { name: 'Ada L.' })

    expect(sessionRepository.rows.every(row => row.revokedAt === null)).toBe(true)
  })

  it('re-hashes the new password so the old one stops verifying', async () => {
    const { service, ctx, userRepository } = await signedIn()

    await service.updateProfile(ctx, {
      password: 'a-fresh-password',
      currentPassword: CREDENTIALS.password
    })

    expect(userRepository.rows[0].passwordHash).toBe('hashed:a-fresh-password')
  })

  it('cannot update a user in a different org', async () => {
    const { service, ctx } = await signedIn()

    await expectAppError(
      service.updateProfile({ ...ctx, org: 'other-org' }, { name: 'Ada L.' }),
      401,
      'UNAUTHENTICATED'
    )
  })
})
