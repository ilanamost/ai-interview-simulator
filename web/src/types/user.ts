/**
 * The only user shape the API ever returns (`User` in .orchestrate/api-contract.yaml).
 * There is deliberately no password, hash, token, or org field here: tokens live in
 * HttpOnly cookies the browser owns, and the org is resolved server-side from the
 * access token. Never add one of those fields client-side.
 */
export interface User {
  id: string
  email: string
  name: string
  /** A base64 image data URL, or null when the user has no avatar. */
  avatarUrl: string | null
}

/** Max avatar bytes before base64 encoding — mirrors the API's 2MB cap. */
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024

/** Image types the API accepts inside an avatar data URL. */
export const AVATAR_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'] as const

/** Minimum password length the API enforces on signup and on a password change. */
export const MIN_PASSWORD_LENGTH = 8
