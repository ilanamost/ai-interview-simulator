/**
 * Machine-readable codes every non-auth route can issue (.rule/error-handling-rules.md).
 * Auth-specific codes live in `AuthErrorCode` (./auth.js) instead.
 */
export enum ErrorCode {
  Internal = 'INTERNAL_ERROR',
  NotFound = 'NOT_FOUND',
  Validation = 'VALIDATION_ERROR',
  Conflict = 'CONFLICT',
  UpstreamUnavailable = 'UPSTREAM_UNAVAILABLE',
  EmptyAnswer = 'EMPTY_ANSWER',
  NoEvaluation = 'NO_EVALUATION'
}
