import type { Queryable } from '../db/types.js'
import type { User } from '../types/user.js'

interface UserRow {
  id: string
  email: string
  name: string
  avatar_url: string | null
  password_hash: string
}

/**
 * The internal view of a user, password hash included. Never returned from a
 * route — `toUser` in auth.service.ts strips it down to the public `User`.
 */
export interface UserRecord extends User {
  passwordHash: string
}

function toRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url,
    passwordHash: row.password_hash
  }
}

const COLUMNS = 'id, email, name, avatar_url, password_hash'

export interface CreateUserInput {
  id: string
  org: string
  email: string
  name: string
  passwordHash: string
}

export interface UpdateUserInput {
  id: string
  org: string
  email?: string
  name?: string
  passwordHash?: string
  avatarUrl?: string | null
}

/**
 * Every query is scoped by `org` (.rule/security-rules.md: enforce tenant isolation
 * on every query) and parameterized — no input is ever concatenated into SQL.
 */
export function createUserRepository(db: Queryable) {
  async function findById(id: string, org: string): Promise<UserRecord | null> {
    const result = await db.query<UserRow>(
      `select ${COLUMNS} from "user"
       where id = $1 and org = $2 and deleted_at is null`,
      [id, org]
    )
    const row = result.rows[0]
    return row ? toRecord(row) : null
  }

  return {
    async createUser(input: CreateUserInput): Promise<UserRecord> {
      const result = await db.query<UserRow>(
        `insert into "user" (id, org, email, name, password_hash)
         values ($1, $2, $3, $4, $5)
         returning ${COLUMNS}`,
        [input.id, input.org, input.email, input.name, input.passwordHash]
      )
      return toRecord(result.rows[0])
    },

    /** Case-insensitive, matching the unique index on `lower(email)`. */
    async findByEmail(email: string, org: string): Promise<UserRecord | null> {
      const result = await db.query<UserRow>(
        `select ${COLUMNS} from "user"
         where lower(email) = lower($1) and org = $2 and deleted_at is null`,
        [email, org]
      )
      const row = result.rows[0]
      return row ? toRecord(row) : null
    },

    findById,

    /**
     * Partial update: only the fields present in `input` are written. Returns null
     * when no row in this org matches, so a caller can never update across orgs.
     */
    async updateUser(input: UpdateUserInput): Promise<UserRecord | null> {
      const assignments: string[] = []
      const params: unknown[] = []

      const push = (column: string, value: unknown): void => {
        params.push(value)
        assignments.push(`${column} = $${params.length}`)
      }

      if (input.email !== undefined) push('email', input.email)
      if (input.name !== undefined) push('name', input.name)
      if (input.passwordHash !== undefined) push('password_hash', input.passwordHash)
      if (input.avatarUrl !== undefined) push('avatar_url', input.avatarUrl)

      if (assignments.length === 0) return findById(input.id, input.org)

      assignments.push('updated_at = now()')
      params.push(input.id, input.org)

      const result = await db.query<UserRow>(
        `update "user" set ${assignments.join(', ')}
         where id = $${params.length - 1} and org = $${params.length} and deleted_at is null
         returning ${COLUMNS}`,
        params
      )
      const row = result.rows[0]
      return row ? toRecord(row) : null
    }
  }
}

export type UserRepository = ReturnType<typeof createUserRepository>
