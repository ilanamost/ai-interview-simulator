import type { Queryable } from '../db/types.js'

interface SessionRow {
  id: string
  user_id: string
  refresh_token_hash: string
  expires_at: Date
  revoked_at: Date | null
}

/** One issued refresh token. Rows are the revocation list logout and password changes write to. */
export interface UserSessionRecord {
  id: string
  userId: string
  refreshTokenHash: string
  expiresAt: Date
  revokedAt: Date | null
}

function toRecord(row: SessionRow): UserSessionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    refreshTokenHash: row.refresh_token_hash,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at
  }
}

const COLUMNS = 'id, user_id, refresh_token_hash, expires_at, revoked_at'

export interface CreateSessionInput {
  id: string
  userId: string
  org: string
  refreshTokenHash: string
  expiresAt: Date
}

/** Every query is scoped by `org` (.rule/security-rules.md), parameterized throughout. */
export function createUserSessionRepository(db: Queryable) {
  return {
    async createSession(input: CreateSessionInput): Promise<UserSessionRecord> {
      const result = await db.query<SessionRow>(
        `insert into user_session (id, user_id, org, refresh_token_hash, expires_at)
         values ($1, $2, $3, $4, $5)
         returning ${COLUMNS}`,
        [input.id, input.userId, input.org, input.refreshTokenHash, input.expiresAt]
      )
      return toRecord(result.rows[0])
    },

    async findSession(id: string, org: string): Promise<UserSessionRecord | null> {
      const result = await db.query<SessionRow>(
        `select ${COLUMNS} from user_session where id = $1 and org = $2`,
        [id, org]
      )
      const row = result.rows[0]
      return row ? toRecord(row) : null
    },

    /** Idempotent: revoking an already-revoked session keeps the original timestamp. */
    async revokeSession(id: string, org: string): Promise<void> {
      await db.query(
        `update user_session set revoked_at = now()
         where id = $1 and org = $2 and revoked_at is null`,
        [id, org]
      )
    },

    /**
     * Revokes every live session for a user, optionally sparing the one making the
     * request — used on password change so other devices are signed out.
     */
    async revokeAllForUser(userId: string, org: string, exceptSessionId?: string): Promise<void> {
      if (exceptSessionId) {
        await db.query(
          `update user_session set revoked_at = now()
           where user_id = $1 and org = $2 and revoked_at is null and id <> $3`,
          [userId, org, exceptSessionId]
        )
        return
      }
      await db.query(
        `update user_session set revoked_at = now()
         where user_id = $1 and org = $2 and revoked_at is null`,
        [userId, org]
      )
    }
  }
}

export type UserSessionRepository = ReturnType<typeof createUserSessionRepository>
