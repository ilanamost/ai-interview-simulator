import { describe, expect, it } from 'vitest'
import { AppError } from '../../utils/app-error.js'
import { createTokenService } from './token.service.js'

function makeTokens(overrides: Partial<Parameters<typeof createTokenService>[0]> = {}) {
  return createTokenService({
    accessSecret: 'access-secret',
    refreshSecret: 'refresh-secret',
    accessTtlMin: 15,
    refreshTtlDays: 30,
    ...overrides
  })
}

const PAYLOAD = { userId: 'u1', org: 'default', sessionId: 's1' }

describe('token.service', () => {
  it('round-trips an access token payload', () => {
    const tokens = makeTokens()

    expect(tokens.verifyAccessToken(tokens.signAccessToken(PAYLOAD))).toEqual(PAYLOAD)
  })

  it('round-trips a refresh token payload', () => {
    const tokens = makeTokens()

    expect(tokens.verifyRefreshToken(tokens.signRefreshToken(PAYLOAD))).toEqual(PAYLOAD)
  })

  it('will not accept a refresh token as an access token', () => {
    const tokens = makeTokens()

    expect(() => tokens.verifyAccessToken(tokens.signRefreshToken(PAYLOAD))).toThrow(AppError)
  })

  it('will not accept an access token as a refresh token', () => {
    const tokens = makeTokens()

    expect(() => tokens.verifyRefreshToken(tokens.signAccessToken(PAYLOAD))).toThrow(AppError)
  })

  it('rejects a token signed with a different secret', () => {
    const mine = makeTokens()
    const theirs = makeTokens({ accessSecret: 'someone-elses-secret' })

    expect(() => mine.verifyAccessToken(theirs.signAccessToken(PAYLOAD))).toThrow(AppError)
  })

  it('rejects a tampered token', () => {
    const tokens = makeTokens()
    const [header, , signature] = tokens.signAccessToken(PAYLOAD).split('.')
    const forgedBody = Buffer.from(
      JSON.stringify({ sub: 'someone-else', org: 'default', sid: 's1' })
    ).toString('base64url')

    expect(() => tokens.verifyAccessToken(`${header}.${forgedBody}.${signature}`)).toThrow(AppError)
  })

  it('rejects an expired token', () => {
    const tokens = makeTokens({ accessTtlMin: -1 })

    expect(() => tokens.verifyAccessToken(tokens.signAccessToken(PAYLOAD))).toThrow(AppError)
  })

  it('rejects garbage that is not a JWT at all', () => {
    const tokens = makeTokens()

    expect(() => tokens.verifyAccessToken('not-a-token')).toThrow(AppError)
  })

  it('answers every rejection with a 401 that explains nothing about why', () => {
    const tokens = makeTokens()

    try {
      tokens.verifyAccessToken('not-a-token')
      expect.unreachable('verifyAccessToken should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(AppError)
      expect((err as AppError).status).toBe(401)
      expect((err as AppError).code).toBe('UNAUTHENTICATED')
      expect((err as AppError).message).not.toMatch(/expired|signature|malformed/i)
    }
  })

  it('hashes a refresh token deterministically and does not echo it back', () => {
    const tokens = makeTokens()
    const token = tokens.signRefreshToken(PAYLOAD)

    const hash = tokens.hashRefreshToken(token)

    expect(hash).toBe(tokens.hashRefreshToken(token))
    expect(hash).not.toContain(token)
    expect(hash).toHaveLength(64)
  })

  it('exposes cookie lifetimes derived from the configured TTLs', () => {
    const tokens = makeTokens({ accessTtlMin: 15, refreshTtlDays: 30 })

    expect(tokens.accessTtlMs).toBe(15 * 60 * 1000)
    expect(tokens.refreshTtlMs).toBe(30 * 24 * 60 * 60 * 1000)
  })
})
