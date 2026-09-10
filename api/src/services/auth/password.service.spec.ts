import { describe, expect, it } from 'vitest'
import { DEFAULT_PASSWORD_COST, createPasswordService } from './password.service.js'

// Cost 4 keeps the suite fast; DEFAULT_PASSWORD_COST is what production uses.
const passwords = createPasswordService(4)

describe('password.service', () => {
  it('hashes to something that is not the password', async () => {
    const hash = await passwords.hash('correct-horse-battery')

    expect(hash).not.toContain('correct-horse-battery')
    expect(hash.startsWith('$2')).toBe(true)
  })

  it('salts: the same password hashes differently every time', async () => {
    const [first, second] = await Promise.all([passwords.hash('same'), passwords.hash('same')])

    expect(first).not.toBe(second)
  })

  it('verifies a correct password', async () => {
    const hash = await passwords.hash('correct-horse-battery')

    await expect(passwords.verify('correct-horse-battery', hash)).resolves.toBe(true)
  })

  it('rejects a wrong password', async () => {
    const hash = await passwords.hash('correct-horse-battery')

    await expect(passwords.verify('wrong-horse-battery', hash)).resolves.toBe(false)
  })

  it('rejects a password that only shares a prefix', async () => {
    const hash = await passwords.hash('correct-horse-battery')

    await expect(passwords.verify('correct-horse', hash)).resolves.toBe(false)
  })

  it('defaults to a cost factor of 12', () => {
    expect(DEFAULT_PASSWORD_COST).toBe(12)
  })
})
