import { describe, expect, it, vi } from 'vitest'
import { createUserRepository } from './user.repository.js'
import type { Queryable } from '../db/types.js'

const ORG = 'default'

const ROW = {
  id: 'u1',
  email: 'ada@example.com',
  name: 'Ada',
  avatar_url: null,
  password_hash: 'hashed'
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

describe('user.repository', () => {
  it('inserts a user scoped to the given org and returns the record', async () => {
    const db = makeDb()
    const repository = createUserRepository(db)

    const record = await repository.createUser({
      id: 'u1',
      org: ORG,
      email: 'ada@example.com',
      name: 'Ada',
      passwordHash: 'hashed'
    })

    expect(record).toEqual({
      id: 'u1',
      email: 'ada@example.com',
      name: 'Ada',
      avatarUrl: null,
      passwordHash: 'hashed'
    })
    expect(db.calls[0].params).toEqual(['u1', ORG, 'ada@example.com', 'Ada', 'hashed'])
  })

  it('looks an email up case-insensitively and always within one org', async () => {
    const db = makeDb()
    const repository = createUserRepository(db)

    await repository.findByEmail('ADA@Example.com', ORG)

    expect(db.calls[0].text).toContain('lower(email) = lower($1)')
    expect(db.calls[0].text).toContain('org = $2')
    expect(db.calls[0].params).toEqual(['ADA@Example.com', ORG])
  })

  it('returns null when no row matches in that org', async () => {
    const repository = createUserRepository(makeDb([]))

    await expect(repository.findById('u1', 'other-org')).resolves.toBeNull()
  })

  it('scopes findById by org so one org can never read another user', async () => {
    const db = makeDb()
    const repository = createUserRepository(db)

    await repository.findById('u1', 'other-org')

    expect(db.calls[0].text).toContain('org = $2')
    expect(db.calls[0].params).toEqual(['u1', 'other-org'])
  })

  it('writes only the fields present on an update, and always filters by org', async () => {
    const db = makeDb()
    const repository = createUserRepository(db)

    await repository.updateUser({ id: 'u1', org: ORG, name: 'Ada L.' })

    const { text, params } = db.calls[0]
    expect(text).toContain('name = $1')
    expect(text).not.toContain('password_hash =')
    expect(text).toContain('updated_at = now()')
    expect(text).toContain('org = $3')
    expect(params).toEqual(['Ada L.', 'u1', ORG])
  })

  it('can clear the avatar by writing an explicit null', async () => {
    const db = makeDb()
    const repository = createUserRepository(db)

    await repository.updateUser({ id: 'u1', org: ORG, avatarUrl: null })

    expect(db.calls[0].text).toContain('avatar_url = $1')
    expect(db.calls[0].params).toEqual([null, 'u1', ORG])
  })

  it('falls back to a plain read when an update carries no changed fields', async () => {
    const db = makeDb()
    const repository = createUserRepository(db)

    await repository.updateUser({ id: 'u1', org: ORG })

    expect(db.calls[0].text).toContain('select')
    expect(db.calls[0].text).not.toContain('update')
  })

  it('never interpolates input into the SQL text', async () => {
    const db = makeDb()
    const repository = createUserRepository(db)

    await repository.findByEmail('ada\'; drop table "user"; --', ORG)

    expect(db.calls[0].text).not.toContain('drop table')
  })
})
