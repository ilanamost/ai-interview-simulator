import { useAuthStore } from '@/stores/auth.store'
import type { User } from '@/types/user'

/** A minimal signed-in user; override only the field a test actually cares about. */
export function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'u1',
    email: 'dev@example.com',
    name: 'Dev User',
    avatarUrl: null,
    ...overrides
  }
}

/**
 * Puts the active pinia into the signed-in state, as if the boot-time `fetchMe()`
 * had found a session. Every route except `/login` is behind the auth guard, so a
 * test that wants to reach the app at all starts here.
 */
export function signIn(overrides: Partial<User> = {}): User {
  const user = makeUser(overrides)
  useAuthStore().user = user
  return user
}
