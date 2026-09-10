/**
 * Domain shapes for authentication. Mirrors web/src/types/user.ts.
 *
 * `User` is the only user shape that ever leaves the API: it deliberately has no
 * password, hash, token, or org field (.rule/security-rules.md — least data).
 */

export interface User {
  id: string
  email: string
  name: string
  avatarUrl: string | null
}

/** Avatars are stored inline as base64 data URLs, capped before encoding. */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024

export const MIN_PASSWORD_LENGTH = 8
export const MAX_PASSWORD_LENGTH = 200
