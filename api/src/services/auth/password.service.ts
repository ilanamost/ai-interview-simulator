import bcrypt from 'bcrypt'

/**
 * bcrypt cost factor for real traffic (.rule/security-rules.md: strong, salted
 * hashing). Tests inject a lower cost so the suite stays fast.
 */
export const DEFAULT_PASSWORD_COST = 12

export function createPasswordService(cost: number = DEFAULT_PASSWORD_COST) {
  return {
    hash(plain: string): Promise<string> {
      return bcrypt.hash(plain, cost)
    },

    /** Constant-time inside bcrypt; never short-circuits on a mismatched prefix. */
    verify(plain: string, hash: string): Promise<boolean> {
      return bcrypt.compare(plain, hash)
    }
  }
}

export type PasswordService = ReturnType<typeof createPasswordService>
