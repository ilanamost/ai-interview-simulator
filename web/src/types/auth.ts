/** Lifecycle of the auth store's session state. */
export enum AuthStatus {
  Idle = 'idle',
  /** The boot-time `fetchMe()` is in flight. */
  Checking = 'checking',
  /** A signup/login/logout/update the user is waiting on. */
  Busy = 'busy',
  /** Auth state is settled, signed in or not. */
  Ready = 'ready'
}

/**
 * Machine-readable codes an `AuthError` can carry. `EmailTaken`, `InvalidCredentials`,
 * `Unauthenticated`, and `ValidationError` mirror what the API's auth routes issue
 * (api/src/types/auth.ts). `NetworkError` and `UnknownError` never come from the API —
 * the transport in `auth.service.ts` invents them for a failed fetch and an
 * unparseable error body, respectively.
 */
export enum AuthErrorCode {
  EmailTaken = 'EMAIL_TAKEN',
  InvalidCredentials = 'INVALID_CREDENTIALS',
  Unauthenticated = 'UNAUTHENTICATED',
  ValidationError = 'VALIDATION_ERROR',
  NetworkError = 'NETWORK_ERROR',
  UnknownError = 'UNKNOWN_ERROR'
}
