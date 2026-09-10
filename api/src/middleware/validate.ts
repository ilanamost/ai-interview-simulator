import type { NextFunction, Request, Response } from 'express'
import type { ZodType } from 'zod'
import { AppError } from '../utils/app-error.js'

/** Strict body validation: unknown fields and malformed values fail fast with a 400 (.rule/security-rules.md). */
export function validateBody(schema: ZodType) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      next(AppError.validation('The request body is invalid.', result.error.flatten()))
      return
    }
    req.body = result.data
    next()
  }
}

export function validateParams(schema: ZodType) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params)
    if (!result.success) {
      next(AppError.validation('The request path is invalid.', result.error.flatten()))
      return
    }
    req.params = result.data as Request['params']
    next()
  }
}

export function validateQuery(schema: ZodType) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query)
    if (!result.success) {
      next(AppError.validation('The request query string is invalid.', result.error.flatten()))
      return
    }
    req.query = result.data as Request['query']
    next()
  }
}
