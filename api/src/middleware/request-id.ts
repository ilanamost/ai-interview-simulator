import { randomUUID } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'

declare module 'express-serve-static-core' {
  interface Request {
    requestId: string
  }
}

/** Correlation id for logs and the error response shape (.rule/error-handling-rules.md). */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  req.requestId = randomUUID()
  res.setHeader('x-request-id', req.requestId)
  next()
}
