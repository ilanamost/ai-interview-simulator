import { Router } from 'express'
import { z } from 'zod'
import { validateBody } from '../middleware/validate.js'
import { getAuth } from '../middleware/require-auth.js'
import { AVATAR_MAX_BYTES, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '../types/user.js'
import type { AuthService } from '../services/auth.service.js'

/** Avatars arrive inline as base64 data URLs — there is no file storage in this stage. */
const AVATAR_DATA_URL = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/

function decodedByteLength(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.floor((base64.length * 3) / 4) - padding
}

const avatarSchema = z
  .string()
  .regex(AVATAR_DATA_URL, 'avatarUrl must be a base64 image data URL')
  .refine(
    value => decodedByteLength(value) <= AVATAR_MAX_BYTES,
    `avatarUrl must be at most ${AVATAR_MAX_BYTES} bytes before encoding`
  )
  .nullable()

const updateUserSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    email: z.string().trim().email().max(254).optional(),
    // null clears the avatar back to the default.
    avatarUrl: avatarSchema.optional(),
    password: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH).optional(),
    currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH).optional()
  })
  .strict()
  .refine(body => Object.keys(body).length > 0, 'Provide at least one field to update')
  .refine(
    body => body.password === undefined || body.currentPassword !== undefined,
    'currentPassword is required when changing the password'
  )

/** Mounted behind require-auth: `org` and the user id come from the token, never the body. */
export function createUserRouter(service: AuthService): Router {
  const router = Router()

  router.get('/', async (req, res, next) => {
    try {
      const user = await service.getCurrentUser(getAuth(req))
      res.status(200).json({ user })
    } catch (err) {
      next(err)
    }
  })

  router.patch('/', validateBody(updateUserSchema), async (req, res, next) => {
    try {
      const user = await service.updateProfile(getAuth(req), req.body)
      res.status(200).json({ user })
    } catch (err) {
      next(err)
    }
  })

  return router
}
