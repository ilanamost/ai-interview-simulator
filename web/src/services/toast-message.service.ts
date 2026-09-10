/**
 * The single home for user-facing toast copy. A pure module with no imports and no IO,
 * the same shape as `label.service.ts` and `animation.service.ts`.
 *
 * Grouping is by feature, not by severity: every call site is feature-local, copy is
 * reworded per feature rather than per severity, and `error`/`success`/`info` is already
 * stated unmissably by `toast.error` vs `toast.success` at the call site — encoding it
 * again in the constant name would just create a second thing that can disagree.
 *
 * Static strings are constants; parameterized ones are arrow functions in the same group,
 * so the template literal — half the copy — never stays behind at the call site.
 */

/** Failures authored by the transport in `auth.service.ts`, before any feature sees them. */
export const API_TOAST = {
  networkUnreachable: 'Could not reach the server. Check your connection and try again.',
  requestRejected: 'The server rejected that request. Please try again.'
} as const

/**
 * Codes the API can return, turned into copy a user can act on. Deliberately not
 * generic: `.rule/error-handling-rules.md` forbids "Something went wrong" when the
 * specific failure is known. The store computes the message; showing it — a toast,
 * inline text, whatever the screen calls for — is the caller's job.
 */
export const AUTH_ERROR_BY_CODE = {
  EMAIL_TAKEN: 'That email is already registered.',
  INVALID_CREDENTIALS: 'Email or password is incorrect.',
  UNAUTHENTICATED: 'Your session has expired. Please sign in again.',
  NETWORK_ERROR: API_TOAST.networkUnreachable
} as const

export const AUTH_TOAST = {
  checkFailed: 'Could not check whether you are signed in.',
  signupFailed: 'Could not create your account. Please try again.',
  signinFailed: 'Could not sign you in. Please try again.',
  logoutFailed: 'Signed out on this device, but the server could not be reached.',
  welcome: (name: string) => `Welcome, ${name}.`,
  welcomeBack: (name: string) => `Welcome back, ${name}.`
} as const

export const PROFILE_TOAST = {
  saveFailed: 'Could not save your profile. Please try again.',
  currentPasswordWrong: 'Your current password is incorrect.',
  nothingToSave: 'Nothing to save yet — change a field first.',
  saved: 'Profile updated.',
  avatarUnusable: 'That image could not be used.',
  avatarTypeRejected: 'Choose a PNG, JPEG, WebP, or GIF image.',
  avatarUnreadable: 'That image could not be read. Try another file.',
  /** Both sizes arrive already formatted, so `formatMb` stays in `avatar.service.ts`. */
  avatarTooLarge: (actual: string, max: string) => `That image is ${actual}. Pick one under ${max}.`
} as const

export const INTERVIEW_TOAST = {
  startFailed: 'Could not start the interview.',
  evaluateFailed: 'Could not evaluate that answer.',
  nextQuestionFailed: 'Could not load the next question.'
} as const

export const REPORT_TOAST = {
  listFailed: 'Could not load your reports.',
  detailFailed: 'Could not load that report.'
} as const
