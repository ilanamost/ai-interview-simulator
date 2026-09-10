import type { CookieOptions, Response } from 'express'

/**
 * Both tokens travel as HttpOnly cookies so no browser script can read them
 * (.rule/security-rules.md).
 *
 * `Secure` and `SameSite` both key off the same `secure` flag, which server.ts
 * wires from `NODE_ENV === 'production'`:
 *
 * - Local dev and tests run both servers over plain http on the same site, where
 *   a `Secure` cookie would never be sent at all — so `Secure` stays off and
 *   `SameSite=Lax` is both sufficient and the safer default.
 * - Staging and production serve the frontend from a different origin than this
 *   API (the deployed frontend is on GitHub Pages while api/ is self-hosted
 *   elsewhere — see .doc/deployment.md), which makes every request genuinely
 *   cross-site. Browsers do not attach a `SameSite=Lax` cookie to a cross-site
 *   fetch, so the cookies must be `SameSite=None` there or every guarded request
 *   401s and the refresh-and-retry 401s with it.
 *
 * Tying both to one boolean is deliberate: browsers reject `SameSite=None`
 * unless it is paired with `Secure`, and this makes that pairing impossible to
 * get wrong.
 */
export const ACCESS_TOKEN_COOKIE = 'access_token'
export const REFRESH_TOKEN_COOKIE = 'refresh_token'

export interface AuthCookieOptions {
  secure: boolean
  accessMaxAgeMs: number
  refreshMaxAgeMs: number
}

function baseOptions(secure: boolean): CookieOptions {
  return { httpOnly: true, sameSite: secure ? 'none' : 'lax', secure, path: '/' }
}

export function setAuthCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string },
  options: AuthCookieOptions
): void {
  const base = baseOptions(options.secure)
  res.cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
    ...base,
    maxAge: options.accessMaxAgeMs
  })
  res.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
    ...base,
    maxAge: options.refreshMaxAgeMs
  })
}

/** Cleared with the same attributes they were set with, or the browser keeps them. */
export function clearAuthCookies(res: Response, options: AuthCookieOptions): void {
  const base = baseOptions(options.secure)
  res.clearCookie(ACCESS_TOKEN_COOKIE, base)
  res.clearCookie(REFRESH_TOKEN_COOKIE, base)
}
