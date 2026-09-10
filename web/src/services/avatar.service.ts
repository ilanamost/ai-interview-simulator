import { AVATAR_MIME_TYPES, MAX_AVATAR_BYTES } from '@/types/user'
import { PROFILE_TOAST } from '@/services/toast-message.service'

/** User-safe error carrying a machine-readable code (.rule/error-handling-rules.md). */
export class AvatarError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'AvatarError'
  }
}

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

/**
 * Turns a picked file into the base64 data URL the API stores in `user.avatarUrl`.
 *
 * The size and type checks run *before* encoding, on purpose: base64 inflates the
 * payload by a third, so an oversized file would otherwise be read, expanded, and
 * uploaded only to come back a 400. Rejecting here costs nothing and can say
 * exactly what was wrong. The API re-checks both — this is UX, not the security
 * boundary (.rule/security-rules.md: never trust a client-side check alone).
 */
export function readAvatarDataUrl(file: File): Promise<string> {
  if (!(AVATAR_MIME_TYPES as readonly string[]).includes(file.type)) {
    throw new AvatarError('AVATAR_TYPE', PROFILE_TOAST.avatarTypeRejected)
  }

  if (file.size > MAX_AVATAR_BYTES) {
    throw new AvatarError(
      'AVATAR_TOO_LARGE',
      PROFILE_TOAST.avatarTooLarge(formatMb(file.size), formatMb(MAX_AVATAR_BYTES))
    )
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new AvatarError('AVATAR_UNREADABLE', PROFILE_TOAST.avatarUnreadable))
        return
      }
      resolve(result)
    }

    reader.onerror = () =>
      reject(new AvatarError('AVATAR_UNREADABLE', PROFILE_TOAST.avatarUnreadable))

    reader.readAsDataURL(file)
  })
}
