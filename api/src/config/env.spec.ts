import { describe, expect, it } from 'vitest'
import { loadEnv } from './env.js'

// Placeholder values only — never a real credential (.claude/skills/writing-tests).
const VALID = {
  DATABASE_URL: 'postgres://localhost:5432/interview',
  ANTHROPIC_API_KEY: 'sk-test',
  JWT_ACCESS_SECRET: 'test-access-secret',
  JWT_REFRESH_SECRET: 'test-refresh-secret'
}

describe('loadEnv', () => {
  it('applies defaults for optional configuration', () => {
    const env = loadEnv(VALID)

    expect(env.PORT).toBe(3001)
    expect(env.ORG_ID).toBe('default')
    expect(env.NODE_ENV).toBe('development')
    expect(env.ACCESS_TOKEN_TTL_MIN).toBe(15)
    expect(env.REFRESH_TOKEN_TTL_DAYS).toBe(30)
  })

  it('fails fast when DATABASE_URL is missing', () => {
    expect(() => loadEnv({ ...VALID, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/)
  })

  it('fails fast when ANTHROPIC_API_KEY is missing', () => {
    expect(() => loadEnv({ ...VALID, ANTHROPIC_API_KEY: undefined })).toThrow(/ANTHROPIC_API_KEY/)
  })

  it('fails fast when a JWT signing secret is missing rather than using a fallback', () => {
    expect(() => loadEnv({ ...VALID, JWT_ACCESS_SECRET: undefined })).toThrow(/JWT_ACCESS_SECRET/)
    expect(() => loadEnv({ ...VALID, JWT_REFRESH_SECRET: undefined })).toThrow(/JWT_REFRESH_SECRET/)
  })

  it('coerces the token TTLs and rejects a non-positive lifetime', () => {
    expect(loadEnv({ ...VALID, ACCESS_TOKEN_TTL_MIN: '5' }).ACCESS_TOKEN_TTL_MIN).toBe(5)
    expect(() => loadEnv({ ...VALID, REFRESH_TOKEN_TTL_DAYS: '0' })).toThrow(
      /REFRESH_TOKEN_TTL_DAYS/
    )
  })

  it('never accidentally logs the resolved secret in the error message for unrelated failures', () => {
    expect(() => loadEnv({ ...VALID, PORT: 'not-a-number' })).toThrow()
    try {
      loadEnv({ ...VALID, PORT: 'not-a-number' })
    } catch (err) {
      expect(String(err)).not.toContain(VALID.ANTHROPIC_API_KEY)
    }
  })
})
