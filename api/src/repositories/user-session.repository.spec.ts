import { describe, expect, it, vi } from 'vitest'
import { createUserSessionRepository } from './user-session.repository.js'
import type { Queryable } from '../db/types.js'

const ORG = 'default'
const EXPIRES_AT = new Date('2026-09-12T10:00:00.000Z')

const ROW = {
  id: 's1',
  user_id: 'u1',
  refresh_token_hash: 'hash',
  expires_at: EXPIRES_AT,
  revoked_at: null
}

function makeDb(rows: Record<string, unknown>[] = [ROW]): Queryable & {
  calls: Array<{ text: string; params?: unknown[] }>
} {
  const calls: Array<{ text: string; params?: unknown[] }> = []
  return {
    calls,
    query: vi.fn(async (text: string, params?: unknown[]) => {
      calls.push({ text, params })
      return { rows }
    })
  } as unknown as Queryable & { calls: Array<{ text: string; params?: unknown[] }> }
}

describe('user-session.repository', () => {
  it('stores only the hash of a refresh token, never the token itself', async () => {
    const db = makeDb()
    const repository = createUserSessionRepository(db)

    await repository.createSession({
      id: 's1',
      userId: 'u1',
      org: ORG,
      refreshTokenHash: 'sha256-hash',
      expiresAt: EXPIRES_AT
    })

    expect(db.calls[0].params).toEqual(['s1', 'u1', ORG, 'sha256-hash', EXPIRES_AT])
  })

  it('maps a row into the record shape callers check for revocation and expiry', async () => {
    const repository = createUserSessionRepository(makeDb())

    const session = await repository.findSession('s1', ORG)

    expect(session).toEqual({
      id: 's1',
      userId: 'u1',
      refreshTokenHash: 'hash',
      expiresAt: EXPIRES_AT,
      revokedAt: null
    })
  })

  it('scopes a session lookup by org', async () => {
    const db = makeDb()
    const repository = createUserSessionRepository(db)

    await repository.findSession('s1', 'other-org')

    expect(db.calls[0].text).toContain('org = $2')
    expect(db.calls[0].params).toEqual(['s1', 'other-org'])
  })

  it('returns null for a session that belongs to a different org', async () => {
    const repository = createUserSessionRepository(makeDb([]))

    await expect(repository.findSession('s1', 'other-org')).resolves.toBeNull()
  })

  it('revokes a single session without touching already-revoked rows', async () => {
    const db = makeDb()
    const repository = createUserSessionRepository(db)

    await repository.revokeSession('s1', ORG)

    expect(db.calls[0].text).toContain('revoked_at = now()')
    expect(db.calls[0].text).toContain('revoked_at is null')
    expect(db.calls[0].params).toEqual(['s1', ORG])
  })

  it('revokes every live session for a user when no session is spared', async () => {
    const db = makeDb()
    const repository = createUserSessionRepository(db)

    await repository.revokeAllForUser('u1', ORG)

    expect(db.calls[0].text).not.toContain('id <>')
    expect(db.calls[0].params).toEqual(['u1', ORG])
  })

  it('spares the calling session when one is named', async () => {
    const db = makeDb()
    const repository = createUserSessionRepository(db)

    await repository.revokeAllForUser('u1', ORG, 's-current')

    expect(db.calls[0].text).toContain('id <> $3')
    expect(db.calls[0].params).toEqual(['u1', ORG, 's-current'])
  })
})
