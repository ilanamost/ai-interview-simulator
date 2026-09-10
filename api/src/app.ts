import cookieParser from 'cookie-parser'
import cors from 'cors'
import express, { type Express } from 'express'
import { errorHandler, notFoundHandler } from './middleware/error-handler.js'
import { requestIdMiddleware } from './middleware/request-id.js'
import { createRequireAuth } from './middleware/require-auth.js'
import { createAuthRouter } from './routes/auth.routes.js'
import { createInterviewRouter } from './routes/interview.routes.js'
import { createUserRouter } from './routes/user.routes.js'
import type { AuthService } from './services/auth.service.js'
import type { TokenService } from './services/auth/token.service.js'
import type { InterviewService } from './services/interview.service.js'

export interface CreateAppOptions {
  interviewService: InterviewService
  authService: AuthService
  tokens: TokenService
  corsOrigin: string
  /** Secure cookies only over https — see utils/auth-cookie.ts. */
  cookieSecure: boolean
}

export function createApp(options: CreateAppOptions): Express {
  const app = express()
  // The auth service doubles as the session verifier: a valid JWT is not enough,
  // the session behind it must still be live on every guarded request.
  const requireAuth = createRequireAuth(options.tokens, options.authService)
  const cookieOptions = {
    secure: options.cookieSecure,
    accessMaxAgeMs: options.tokens.accessTtlMs,
    refreshMaxAgeMs: options.tokens.refreshTtlMs
  }

  app.use(requestIdMiddleware)
  // credentials: true is what lets the auth cookies travel from the dev frontend
  // origin; the origin itself stays an explicit allowlist of one.
  app.use(cors({ origin: options.corsOrigin, credentials: true }))
  app.use(cookieParser())
  // Avatars are base64 data URLs capped at 2MB pre-encoding (~2.7MB encoded), so
  // /api/user needs a bigger body limit than the rest of the API gets.
  app.use('/api/user', express.json({ limit: '4mb' }))
  app.use(express.json({ limit: '256kb' }))

  app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }))

  app.use('/api/auth', createAuthRouter(options.authService, cookieOptions))
  app.use('/api/user', requireAuth, createUserRouter(options.authService))
  // org is no longer a static option: interview routes read it off the
  // authenticated request (.rule/security-rules.md — tenant isolation per request).
  app.use('/api/interview', requireAuth, createInterviewRouter(options.interviewService))

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
