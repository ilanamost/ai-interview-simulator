/**
 * Shared entrance-animation timing. A pure module with no IO, the same shape as
 * `label.service.ts`: the CSS lives in `styles/cmps/animation.scss` and only the
 * per-item delay has to be computed, so both call sites agree on the numbers.
 */

/**
 * Staggering the repeated cards reads as a sequence rather than a flash. The cap
 * keeps the longest list (7 features) finishing well under half a second, so the
 * page never feels like it is still loading.
 *
 * The cap is load-bearing for a second reason: the global reduced-motion rule in
 * `styles/setup/reset.scss` neutralises `animation-duration` with `!important` but not
 * `animation-delay`, and `staggerStyle` sets the delay inline — the highest-priority
 * origin. A reduced-motion reader therefore still waits out the delay on a card held
 * at `opacity: 0` by `animation-fill-mode: both`. A quarter second is imperceptible;
 * an uncapped `index * step` over a dozen cards would not be.
 */
export const STAGGER_STEP_MS = 50
export const MAX_STAGGER_MS = 250

export function staggerStyle(index: number) {
  return { animationDelay: `${Math.min(index * STAGGER_STEP_MS, MAX_STAGGER_MS)}ms` }
}
