import { describe, expect, it } from 'vitest'
import {
  AUTO_DISMISS_MS,
  ENCOURAGEMENT_INTERVAL,
  ENCOURAGEMENT_MESSAGES,
  SUCCESS_GRADE_THRESHOLD,
  isSuccessfulGrade,
  pickEncouragementMessage
} from './gamification.service'

describe('isSuccessfulGrade', () => {
  it('counts a grade above the threshold as successful', () => {
    expect(isSuccessfulGrade(85)).toBe(true)
  })

  /** The badge turns `is-good` at exactly 70, so this has to agree with it. */
  it('counts the threshold itself as successful', () => {
    expect(isSuccessfulGrade(SUCCESS_GRADE_THRESHOLD)).toBe(true)
  })

  it('does not count the grade one point below the threshold', () => {
    expect(isSuccessfulGrade(SUCCESS_GRADE_THRESHOLD - 1)).toBe(false)
  })

  it('does not count a clearly weak grade', () => {
    expect(isSuccessfulGrade(0)).toBe(false)
  })
})

describe('pickEncouragementMessage', () => {
  it('returns the first message for the first milestone', () => {
    expect(pickEncouragementMessage(0)).toBe(ENCOURAGEMENT_MESSAGES[0])
  })

  it('returns a different message for each milestone within one pass of the pool', () => {
    const picked = ENCOURAGEMENT_MESSAGES.map((_, index) => pickEncouragementMessage(index))

    expect(new Set(picked).size).toBe(ENCOURAGEMENT_MESSAGES.length)
  })

  it('wraps back to the first message once the pool runs out', () => {
    expect(pickEncouragementMessage(ENCOURAGEMENT_MESSAGES.length)).toBe(ENCOURAGEMENT_MESSAGES[0])
    expect(pickEncouragementMessage(ENCOURAGEMENT_MESSAGES.length + 1)).toBe(
      ENCOURAGEMENT_MESSAGES[1]
    )
  })
})

describe('encouragement cadence constants', () => {
  it('celebrates every successful answer', () => {
    expect(ENCOURAGEMENT_INTERVAL).toBe(1)
  })

  it('auto-dismisses fast enough not to sit on top of the next question', () => {
    expect(AUTO_DISMISS_MS).toBeGreaterThan(0)
    expect(AUTO_DISMISS_MS).toBeLessThanOrEqual(6000)
  })
})
