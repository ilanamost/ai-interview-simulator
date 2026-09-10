/**
 * Everything the encouragement milestone popup is made of: when it fires, how often,
 * and what it says. A pure module with no runtime imports and no IO, the same shape as
 * `toast-message.service.ts` and `animation.service.ts` — the icons that pair with these
 * messages are picked in `EncouragementModal.vue`, so nothing here pulls in a component
 * library and every value below stays trivially testable.
 */

import type { Grade } from '@/types/interview'

/**
 * The same cutoff `GradeBadge.vue` already draws its `is-good` line at, reused so
 * "successful" here means exactly what the badge already shows the user it means.
 */
export const SUCCESS_GRADE_THRESHOLD = 70

/**
 * How many successful answers in a row earn a celebration. `1` means every successful
 * answer fires one — kept as a named constant, not inlined into `submitAnswer`, so the
 * cadence stays a one-line change if it needs to go back to a wider gap later.
 */
export const ENCOURAGEMENT_INTERVAL = 1

/** Long enough to read, short enough never to sit on top of the next question. */
export const AUTO_DISMISS_MS = 4000

/**
 * Five lines, varied in register, cycled by milestone index rather than chosen at
 * random: the mock interview source is deliberately deterministic, and cycling means
 * nobody sees the same line twice in one interview.
 */
export const ENCOURAGEMENT_MESSAGES = [
  "You're awesome!",
  'Great job!',
  'Nice work — keep it up!',
  "You're on a roll!",
  'Impressive answer!'
] as const

export function isSuccessfulGrade(grade: Grade): boolean {
  return grade >= SUCCESS_GRADE_THRESHOLD
}

/** `milestoneIndex` is 0-based: the first celebration of an interview is index 0. */
export function pickEncouragementMessage(milestoneIndex: number): string {
  return ENCOURAGEMENT_MESSAGES[milestoneIndex % ENCOURAGEMENT_MESSAGES.length]
}
