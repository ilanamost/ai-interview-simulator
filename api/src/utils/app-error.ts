/**
 * Stable error shape per .rule/error-handling-rules.md: every non-2xx response
 * carries a machine-readable code and a user-safe message. Internal detail
 * (stack traces, SQL, provider payloads) never reaches the client.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown
  ) {
    super(message)
    this.name = 'AppError'
  }

  static validation(message: string, details?: unknown): AppError {
    return new AppError(400, 'VALIDATION_ERROR', message, details)
  }

  /**
   * 401 — the request carries no usable credentials. `code` separates a missing or
   * expired session (`UNAUTHENTICATED`) from rejected login input
   * (`INVALID_CREDENTIALS`), which never says whether the email exists.
   */
  static unauthenticated(code: string, message: string): AppError {
    return new AppError(401, code, message)
  }

  static notFound(message: string): AppError {
    return new AppError(404, 'NOT_FOUND', message)
  }

  /** 409 — state conflict. `code` narrows it, e.g. `EMAIL_TAKEN` on signup. */
  static conflict(message: string, code = 'CONFLICT'): AppError {
    return new AppError(409, code, message)
  }

  static domain(code: string, message: string): AppError {
    return new AppError(422, code, message)
  }

  static upstreamUnavailable(message: string): AppError {
    return new AppError(502, 'UPSTREAM_UNAVAILABLE', message)
  }
}
