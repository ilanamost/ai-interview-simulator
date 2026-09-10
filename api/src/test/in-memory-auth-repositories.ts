import type {
  CreateUserInput,
  UpdateUserInput,
  UserRecord,
  UserRepository
} from '../repositories/user.repository.js'
import type {
  CreateSessionInput,
  UserSessionRecord,
  UserSessionRepository
} from '../repositories/user-session.repository.js'

/**
 * In-memory stand-ins for the two auth repositories, used by the HTTP integration
 * tests so a full signup → login → refresh → logout flow can run without a
 * database. They keep the same org scoping the SQL does — a row stored under one
 * org is invisible to every other org, which is exactly what the boundary tests
 * assert.
 */

interface StoredUser extends UserRecord {
  org: string
}

export function createInMemoryUserRepository(seed: StoredUser[] = []): UserRepository & {
  rows: StoredUser[]
} {
  const rows: StoredUser[] = [...seed]

  function findById(id: string, org: string): Promise<UserRecord | null> {
    return Promise.resolve(rows.find(row => row.id === id && row.org === org) ?? null)
  }

  return {
    rows,

    createUser(input: CreateUserInput): Promise<UserRecord> {
      const row: StoredUser = {
        id: input.id,
        org: input.org,
        email: input.email,
        name: input.name,
        avatarUrl: null,
        passwordHash: input.passwordHash
      }
      rows.push(row)
      return Promise.resolve(row)
    },

    findByEmail(email: string, org: string): Promise<UserRecord | null> {
      const match = rows.find(
        row => row.email.toLowerCase() === email.toLowerCase() && row.org === org
      )
      return Promise.resolve(match ?? null)
    },

    findById,

    updateUser(input: UpdateUserInput): Promise<UserRecord | null> {
      const row = rows.find(candidate => candidate.id === input.id && candidate.org === input.org)
      if (!row) return Promise.resolve(null)

      if (input.email !== undefined) row.email = input.email
      if (input.name !== undefined) row.name = input.name
      if (input.passwordHash !== undefined) row.passwordHash = input.passwordHash
      if (input.avatarUrl !== undefined) row.avatarUrl = input.avatarUrl
      return Promise.resolve(row)
    }
  }
}

interface StoredSession extends UserSessionRecord {
  org: string
}

export function createInMemorySessionRepository(): UserSessionRepository & {
  rows: StoredSession[]
} {
  const rows: StoredSession[] = []

  return {
    rows,

    createSession(input: CreateSessionInput): Promise<UserSessionRecord> {
      const row: StoredSession = {
        id: input.id,
        userId: input.userId,
        org: input.org,
        refreshTokenHash: input.refreshTokenHash,
        expiresAt: input.expiresAt,
        revokedAt: null
      }
      rows.push(row)
      return Promise.resolve(row)
    },

    findSession(id: string, org: string): Promise<UserSessionRecord | null> {
      return Promise.resolve(rows.find(row => row.id === id && row.org === org) ?? null)
    },

    revokeSession(id: string, org: string): Promise<void> {
      const row = rows.find(candidate => candidate.id === id && candidate.org === org)
      if (row && !row.revokedAt) row.revokedAt = new Date()
      return Promise.resolve()
    },

    revokeAllForUser(userId: string, org: string, exceptSessionId?: string): Promise<void> {
      for (const row of rows) {
        if (row.userId !== userId || row.org !== org) continue
        if (exceptSessionId && row.id === exceptSessionId) continue
        if (!row.revokedAt) row.revokedAt = new Date()
      }
      return Promise.resolve()
    }
  }
}
