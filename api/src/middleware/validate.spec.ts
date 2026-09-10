import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { NextFunction, Request, Response } from 'express'
import { validateBody, validateParams, validateQuery } from './validate.js'

function makeReq(overrides: Partial<Request> = {}): Request {
  return { body: {}, params: {}, query: {}, ...overrides } as Request
}

describe('validateBody', () => {
  const schema = z.object({ text: z.string().min(1) }).strict()

  it('calls next() and replaces req.body with the parsed value on success', () => {
    const req = makeReq({ body: { text: 'hello' } })
    const next = vi.fn() as NextFunction

    validateBody(schema)(req, {} as Response, next)

    expect(next).toHaveBeenCalledWith()
    expect(req.body).toEqual({ text: 'hello' })
  })

  it('passes a VALIDATION_ERROR AppError to next() on invalid input', () => {
    const req = makeReq({ body: { text: '' } })
    const next = vi.fn() as NextFunction

    validateBody(schema)(req, {} as Response, next)

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'VALIDATION_ERROR', status: 400 })
    )
  })

  it('rejects unexpected fields (.rule/security-rules.md: strict schema validation)', () => {
    const req = makeReq({ body: { text: 'hello', extra: 'nope' } })
    const next = vi.fn() as NextFunction

    validateBody(schema)(req, {} as Response, next)

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'VALIDATION_ERROR' }))
  })
})

describe('validateQuery', () => {
  const schema = z.object({ level: z.enum(['junior', 'senior']).optional() }).strict()

  it('calls next() and replaces req.query with the parsed value on success', () => {
    const req = makeReq({ query: { level: 'senior' } })
    const next = vi.fn() as NextFunction

    validateQuery(schema)(req, {} as Response, next)

    expect(next).toHaveBeenCalledWith()
    expect(req.query).toEqual({ level: 'senior' })
  })

  it('accepts an empty query string when every field is optional', () => {
    const req = makeReq({ query: {} })
    const next = vi.fn() as NextFunction

    validateQuery(schema)(req, {} as Response, next)

    expect(next).toHaveBeenCalledWith()
  })

  it('passes a VALIDATION_ERROR AppError to next() on an out-of-enum value', () => {
    const req = makeReq({ query: { level: 'principal' } })
    const next = vi.fn() as NextFunction

    validateQuery(schema)(req, {} as Response, next)

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'VALIDATION_ERROR', status: 400 })
    )
  })

  it('rejects unexpected query params (.rule/security-rules.md: strict schema validation)', () => {
    const req = makeReq({ query: { level: 'senior', extra: 'nope' } })
    const next = vi.fn() as NextFunction

    validateQuery(schema)(req, {} as Response, next)

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'VALIDATION_ERROR' }))
  })
})

describe('validateParams', () => {
  const schema = z.object({ id: z.string().min(1) }).strict()

  it('accepts a valid id param', () => {
    const req = makeReq({ params: { id: 'abc' } })
    const next = vi.fn() as NextFunction

    validateParams(schema)(req, {} as Response, next)

    expect(next).toHaveBeenCalledWith()
  })

  it('rejects a missing id param', () => {
    const req = makeReq({ params: {} })
    const next = vi.fn() as NextFunction

    validateParams(schema)(req, {} as Response, next)

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'VALIDATION_ERROR', status: 400 })
    )
  })
})
