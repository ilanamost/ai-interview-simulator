import { createHash } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { AppError } from '../../utils/app-error.js'

/**
 * Both tokens are JWTs delivered as HttpOnly cookies, so the browser's JS never
 * reads them (.rule/security-rules.md). They are signed with separate secrets:
 * an access token can never be replayed as a refresh token, or the reverse.
 *
 * Both carry `sessionId`, which is what makes revocation possible — the access
 * token alone tells us which `user_session` row a password change should spare.
 */
export interface AccessTokenPayload {
  userId: string
  org: string
  sessionId: string
}

export type RefreshTokenPayload = AccessTokenPayload

export interface TokenServiceOptions {
  accessSecret: string
  refreshSecret: string
  accessTtlMin: number
  refreshTtlDays: number
}

interface Claims {
  sub?: unknown
  org?: unknown
  sid?: unknown
}

const UNAUTHENTICATED = 'Your session is no longer valid. Please sign in again.'

function readPayload(secret: string, token: string): AccessTokenPayload {
  let claims: unknown
  try {
    claims = jwt.verify(token, secret)
  } catch {
    // Expired, tampered, wrong secret and malformed all collapse into one answer:
    // the client learns nothing about why beyond "sign in again".
    throw AppError.unauthenticated('UNAUTHENTICATED', UNAUTHENTICATED)
  }

  const { sub, org, sid } = (claims ?? {}) as Claims
  if (typeof sub !== 'string' || typeof org !== 'string' || typeof sid !== 'string') {
    throw AppError.unauthenticated('UNAUTHENTICATED', UNAUTHENTICATED)
  }
  return { userId: sub, org, sessionId: sid }
}

export function createTokenService(options: TokenServiceOptions) {
  const accessTtlSec = options.accessTtlMin * 60
  const refreshTtlSec = options.refreshTtlDays * 24 * 60 * 60

  function sign(secret: string, ttlSec: number, payload: AccessTokenPayload): string {
    return jwt.sign({ org: payload.org, sid: payload.sessionId }, secret, {
      subject: payload.userId,
      expiresIn: ttlSec
    })
  }

  return {
    accessTtlMs: accessTtlSec * 1000,
    refreshTtlMs: refreshTtlSec * 1000,

    signAccessToken(payload: AccessTokenPayload): string {
      return sign(options.accessSecret, accessTtlSec, payload)
    },

    signRefreshToken(payload: RefreshTokenPayload): string {
      return sign(options.refreshSecret, refreshTtlSec, payload)
    },

    /** Throws a 401 AppError rather than returning null — callers must fail closed. */
    verifyAccessToken(token: string): AccessTokenPayload {
      return readPayload(options.accessSecret, token)
    },

    verifyRefreshToken(token: string): RefreshTokenPayload {
      return readPayload(options.refreshSecret, token)
    },

    /**
     * What gets persisted in `user_session.refresh_token_hash`. SHA-256 rather than
     * bcrypt: the input is a high-entropy signed token, not a guessable password,
     * and bcrypt would truncate it at 72 bytes.
     */
    hashRefreshToken(token: string): string {
      return createHash('sha256').update(token).digest('hex')
    }
  }
}

export type TokenService = ReturnType<typeof createTokenService>
