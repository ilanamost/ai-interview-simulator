import { Router } from 'express'
import { z } from 'zod'
import { validateBody } from '../middleware/validate.js'
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  clearAuthCookies,
  setAuthCookies,
  type AuthCookieOptions
} from '../utils/auth-cookie.js'
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '../types/user.js'
import type { AuthService } from '../services/auth.service.js'

const signupSchema = z
  .object({
    email: z.string().trim().email().max(254),
    name: z.string().trim().min(1).max(100),
    password: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH)
  })
  .strict()

// No length floor on login: the rule is "does it match", and rejecting a short
// password here would leak which stored passwords are old/short.
const loginSchema = z
  .object({
    email: z.string().trim().email().max(254),
    password: z.string().min(1).max(MAX_PASSWORD_LENGTH)
  })
  .strict()

/** Logout and refresh read cookies, not a body — anything sent is a client bug. */
const emptyBodySchema = z.object({}).strict()

/**
 * Public routes: these are the "explicitly public" exceptions require-auth does not
 * guard (.rule/security-rules.md). Every response body is `{ user }` — no token
 * ever appears in a payload, only in HttpOnly cookies.
 */
export function createAuthRouter(service: AuthService, cookieOptions: AuthCookieOptions): Router {
  const router = Router()

  router.post('/signup', validateBody(signupSchema), async (req, res, next) => {
    try {
      const result = await service.signup(req.body)
      setAuthCookies(res, result, cookieOptions)
      res.status(201).json({ user: result.user })
    } catch (err) {
      next(err)
    }
  })

  router.post('/login', validateBody(loginSchema), async (req, res, next) => {
    try {
      const result = await service.login(req.body)
      setAuthCookies(res, result, cookieOptions)
      res.status(200).json({ user: result.user })
    } catch (err) {
      next(err)
    }
  })

  router.post('/logout', validateBody(emptyBodySchema), async (req, res, next) => {
    try {
      await service.logout({
        refreshToken: req.cookies?.[REFRESH_TOKEN_COOKIE],
        accessToken: req.cookies?.[ACCESS_TOKEN_COOKIE]
      })
      clearAuthCookies(res, cookieOptions)
      res.status(204).end()
    } catch (err) {
      next(err)
    }
  })

  router.post('/refresh', validateBody(emptyBodySchema), async (req, res, next) => {
    try {
      const result = await service.refresh(req.cookies?.[REFRESH_TOKEN_COOKIE])
      setAuthCookies(res, result, cookieOptions)
      res.status(200).json({ user: result.user })
    } catch (err) {
      // A rejected refresh means the session is gone for good; drop the stale
      // cookies so the browser stops replaying them.
      clearAuthCookies(res, cookieOptions)
      next(err)
    }
  })

  return router
}
