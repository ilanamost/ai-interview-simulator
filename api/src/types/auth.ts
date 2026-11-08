/**
 * Machine-readable codes the auth routes issue. Mirrors web/src/types/auth.ts —
 * only the subset an `AuthError` there ever receives from this API; `VALIDATION_ERROR`
 * is `AppError.validation`'s own generic code, shared by every route, not auth-specific.
 */
export enum AuthErrorCode {
  EmailTaken = 'EMAIL_TAKEN',
  InvalidCredentials = 'INVALID_CREDENTIALS',
  Unauthenticated = 'UNAUTHENTICATED'
}
