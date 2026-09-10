/**
 * Minimal structured logger (.rule/error-handling-rules.md: structured logs,
 * requestId/org/operation context, no secrets). Swap for a real logging
 * library later without touching call sites.
 */
export interface LogContext {
  requestId?: string
  org?: string
  operation?: string
  [key: string]: unknown
}

function write(level: 'info' | 'warn' | 'error', message: string, context: LogContext = {}): void {
  const line = { level, message, ...context, timestamp: new Date().toISOString() }
  const target = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  target(JSON.stringify(line))
}

export const logger = {
  info: (message: string, context?: LogContext) => write('info', message, context),
  warn: (message: string, context?: LogContext) => write('warn', message, context),
  error: (message: string, context?: LogContext) => write('error', message, context)
}
