import { describe, expect, it } from 'vitest'
import { AvatarError, readAvatarDataUrl } from './avatar.service'
import { MAX_AVATAR_BYTES } from '@/types/user'

function makeFile(bytes: number, type = 'image/png'): File {
  return new File([new Uint8Array(bytes)], 'avatar.png', { type })
}

describe('readAvatarDataUrl', () => {
  it('encodes an accepted image as a data URL', async () => {
    const result = await readAvatarDataUrl(makeFile(64))

    expect(result.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('rejects a file over the 2MB cap before encoding it', () => {
    // Thrown synchronously, so nothing is read and no request is ever built.
    expect(() => readAvatarDataUrl(makeFile(MAX_AVATAR_BYTES + 1))).toThrowError(AvatarError)

    try {
      readAvatarDataUrl(makeFile(MAX_AVATAR_BYTES + 1))
    } catch (err) {
      expect((err as AvatarError).code).toBe('AVATAR_TOO_LARGE')
      expect((err as AvatarError).message).toContain('2.0MB')
    }
  })

  it('accepts a file exactly at the cap', async () => {
    await expect(readAvatarDataUrl(makeFile(MAX_AVATAR_BYTES))).resolves.toContain('base64,')
  })

  it('rejects a type the API would not store', () => {
    expect(() => readAvatarDataUrl(makeFile(64, 'application/pdf'))).toThrowError(
      /PNG, JPEG, WebP, or GIF/
    )
  })
})
