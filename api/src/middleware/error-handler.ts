import type { NextFunction, Request, Response } from 'express'
import { AppError } from '../utils/app-error.js'
import { logger } from '../utils/logger.js'

/** Every non-2xx response uses this shape (.rule/error-handling-rules.md). Must be registered last. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const requestId = req.requestId

  if (err instanceof AppError) {
    if (err.status >= 500) {
      logger.error(err.message, {
        requestId,
        code: err.code,
        operation: `${req.method} ${req.path}`
      })
    }
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
      requestId
    })
    return
  }

  logger.error('Unhandled error', {
    requestId,
    operation: `${req.method} ${req.path}`,
    error: err instanceof Error ? err.message : String(err)
  })
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' },
    requestId
  })
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `No route matches ${req.method} ${req.path}.` },
    requestId: req.requestId
  })
}
