import { describe, expect, it } from 'vitest'
import {
  API_TOAST,
  AUTH_ERROR_BY_CODE,
  AUTH_TOAST,
  INTERVIEW_TOAST,
  PROFILE_TOAST,
  REPORT_TOAST
} from './toast-message.service'

/**
 * These tests guard the module's shape — that a group exists, is non-empty, and holds no
 * blank copy. They deliberately do not restate the wording: the existing view and store
 * specs already assert the exact literals, and that is what proves nothing was reworded.
 */
const GROUPS = {
  API_TOAST,
  AUTH_ERROR_BY_CODE,
  AUTH_TOAST,
  INTERVIEW_TOAST,
  PROFILE_TOAST,
  REPORT_TOAST
} as const

/** Resolves an entry to the string a user would actually read. */
function render(value: string | ((...args: string[]) => string)): string {
  return typeof value === 'function' ? value('one', 'two') : value
}

describe('toast message groups', () => {
  it.each(Object.keys(GROUPS))('%s exports at least one message', name => {
    const group = GROUPS[name as keyof typeof GROUPS]

    expect(Object.keys(group).length).toBeGreaterThan(0)
  })

  it.each(Object.keys(GROUPS))('%s has no empty or whitespace-only copy', name => {
    const group: Record<string, string | ((...args: string[]) => string)> = GROUPS[
      name as keyof typeof GROUPS
    ]

    for (const [key, value] of Object.entries(group)) {
      expect(`${key}: ${render(value).trim()}`).not.toBe(`${key}: `)
    }
  })
})

describe('AUTH_ERROR_BY_CODE', () => {
  it('covers every code the auth store maps', () => {
    expect(Object.keys(AUTH_ERROR_BY_CODE).sort()).toEqual([
      'EMAIL_TAKEN',
      'INVALID_CREDENTIALS',
      'NETWORK_ERROR',
      'UNAUTHENTICATED'
    ])
  })

  it('shares one string with the transport rather than duplicating it', () => {
    // The duplicate this module exists to kill: the store's NETWORK_ERROR copy and the
    // message `auth.service.ts` throws are now the same constant, not two literals.
    expect(AUTH_ERROR_BY_CODE.NETWORK_ERROR).toBe(API_TOAST.networkUnreachable)
  })
})

describe('parameterized copy', () => {
  it('greets a named user on signup and on return', () => {
    expect(AUTH_TOAST.welcome('Dev User')).toBe('Welcome, Dev User.')
    expect(AUTH_TOAST.welcomeBack('Dev User')).toBe('Welcome back, Dev User.')
  })

  it('names both the actual and the maximum size when an avatar is too large', () => {
    const message = PROFILE_TOAST.avatarTooLarge('2.5MB', '2.0MB')

    expect(message).toContain('2.5MB')
    expect(message).toContain('under 2.0MB')
  })

  it('interpolates an empty name rather than dropping the sentence', () => {
    // The caller guards against a blank name; the constant must still return real copy.
    expect(AUTH_TOAST.welcome('').trim()).not.toBe('')
    expect(PROFILE_TOAST.avatarTooLarge('', '').trim()).not.toBe('')
  })
})
