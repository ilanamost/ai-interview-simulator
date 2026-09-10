import type { NextFunction, Request, Response } from 'express'
import { AppError } from '../utils/app-error.js'
import { logger } from '../utils/logger.js'
import { ACCESS_TOKEN_COOKIE } from '../utils/auth-cookie.js'
import type { AuthContext } from '../services/auth.service.js'
import type { AccessTokenPayload, TokenService } from '../services/auth/token.service.js'

export interface RequestUser {
  id: string
  sessionId: string
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: RequestUser
    /** The authenticated user's org — the only source of `org` for guarded routes. */
    org?: string
  }
}

/**
 * The slice of the auth service this middleware needs. Narrow on purpose: the
 * middleware asks one question and cannot reach the rest of the service.
 */
export interface SessionVerifier {
  assertSessionActive(payload: AccessTokenPayload): Promise<void>
}

/**
 * Guards every route that is not explicitly public (.rule/security-rules.md).
 * Fails closed: a missing, malformed, or expired access cookie is a 401, never a
 * fallback to some default identity.
 *
 * A valid signature is necessary but not sufficient. The `user_session` row named by
 * the token's `sid` claim must also still be live, so logout and password-change
 * revocation bite on the very next request instead of lingering until the access
 * token expires. That check costs one indexed read per guarded request.
 */
export function createRequireAuth(tokens: TokenService, sessions: SessionVerifier) {
  return function requireAuth(req: Request, _res: Response, next: NextFunction): void {
    const token = req.cookies?.[ACCESS_TOKEN_COOKIE] as string | undefined
    // originalUrl, not path: requireAuth runs before the mount path is stripped
    // back on, and "GET /" is useless in a security log.
    const operation = `${req.method} ${req.originalUrl}`

    if (!token) {
      logger.warn('Rejected an unauthenticated request', { requestId: req.requestId, operation })
      next(AppError.unauthenticated('UNAUTHENTICATED', 'You must be signed in to do that.'))
      return
    }

    let payload: AccessTokenPayload
    try {
      payload = tokens.verifyAccessToken(token)
    } catch (err) {
      logger.warn('Rejected an invalid access token', { requestId: req.requestId, operation })
      next(err)
      return
    }

    sessions
      .assertSessionActive(payload)
      .then(() => {
        req.user = { id: payload.userId, sessionId: payload.sessionId }
        req.org = payload.org
        next()
      })
      .catch((err: unknown) => {
        logger.warn('Rejected an access token for a revoked or missing session', {
          requestId: req.requestId,
          org: payload.org,
          operation
        })
        next(err)
      })
  }
}

/**
 * Narrows the request fields `requireAuth` sets. Only call it from routes mounted
 * behind the middleware; it throws rather than inventing an anonymous identity.
 */
export function getAuth(req: Request): AuthContext {
  if (!req.user || !req.org) {
    throw AppError.unauthenticated('UNAUTHENTICATED', 'You must be signed in to do that.')
  }
  return { userId: req.user.id, org: req.org, sessionId: req.user.sessionId }
}
