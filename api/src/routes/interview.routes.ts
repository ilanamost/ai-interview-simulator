import { Router } from 'express'
import { z } from 'zod'
import {
  EXPERIENCE_LEVELS,
  INTERVIEW_SORTS,
  INTERVIEW_TYPES,
  JOB_TITLES,
  LLM_MODELS,
  MAX_PAGE_SIZE
} from '../types/interview.js'
import type { ListInterviewQuery } from '../repositories/interview.repository.js'
import type { InterviewService } from '../services/interview.service.js'
import { validateBody, validateParams, validateQuery } from '../middleware/validate.js'
import { getAuth } from '../middleware/require-auth.js'

const idParamsSchema = z.object({ id: z.string().min(1) }).strict()

/**
 * A whole number arriving as a query string. Coerced only from a string of digits,
 * never with a bare `z.coerce.number()`: Express parses `?page[]=2` into an array and
 * `Number(['2'])` is 2, so a plain coercion would read a shape that is not a page
 * number at all as one. Anything else — `1.5`, `abc`, an empty value, an object — is
 * left untouched and fails the number schema with a 400.
 */
function intQueryParam(schema: z.ZodNumber) {
  return z.preprocess(
    value => (typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : value),
    schema
  )
}

/**
 * Every filter is optional and they combine. `z.iso.date()` rejects both a
 * wrong shape (`15-08-2026`) and an impossible day (`2026-02-30`), so the
 * repository never hands Postgres a value it cannot cast.
 *
 * `page`/`pageSize` are REJECTED out of range rather than clamped (plan 018): a client
 * asking for page 0 has a bug worth surfacing, and a caller must never silently get a
 * different page size than the one it asked for. The defaults (page 1, DEFAULT_PAGE_SIZE
 * rows) are applied by the repository, so an omitted parameter stays omitted here and
 * the service is still handed only the keys the caller actually sent.
 */
const listInterviewQuerySchema = z
  .object({
    date: z.iso.date().optional(),
    jobTitle: z.enum(JOB_TITLES).optional(),
    level: z.enum(EXPERIENCE_LEVELS).optional(),
    type: z.enum(INTERVIEW_TYPES).optional(),
    sort: z.enum(INTERVIEW_SORTS).optional(),
    page: intQueryParam(z.number().int().min(1)).optional(),
    pageSize: intQueryParam(z.number().int().min(1).max(MAX_PAGE_SIZE)).optional()
  })
  .strict()

const createInterviewSchema = z
  .object({
    jobTitle: z.enum(JOB_TITLES),
    level: z.enum(EXPERIENCE_LEVELS),
    type: z.enum(INTERVIEW_TYPES),
    jobDescription: z.string().max(5000).optional(),
    questionCount: z.number().int().min(1).max(20),
    // Allowlisted, never a free string: an unknown model must fail here rather
    // than reach the provider (.rule/security-rules.md).
    model: z.enum(LLM_MODELS).optional()
  })
  .strict()

const submitAnswerSchema = z
  .object({
    questionId: z.string().min(1),
    text: z.string().min(1).max(10000)
  })
  .strict()

/**
 * Mounted behind require-auth. `org` comes from the authenticated request on every
 * call, so one user can never read or write another org's interviews.
 */
export function createInterviewRouter(service: InterviewService): Router {
  const router = Router()

  router.post('/', validateBody(createInterviewSchema), async (req, res, next) => {
    try {
      const session = await service.startInterview(getAuth(req).org, req.body)
      res.status(201).json(session)
    } catch (err) {
      next(err)
    }
  })

  // Registered ahead of '/:id' for readability only — the two cannot collide,
  // since ':id' never matches an empty segment (covered by a test).
  router.get('/', validateQuery(listInterviewQuerySchema), async (req, res, next) => {
    try {
      const result = await service.listInterviews(
        getAuth(req).org,
        req.query as ListInterviewQuery
      )
      // `total` counts the whole filtered set, so the client can size its pager from
      // one response rather than paging to the end to find out how long the list is.
      res.status(200).json({ interviews: result.items, total: result.total })
    } catch (err) {
      next(err)
    }
  })

  router.get('/:id', validateParams(idParamsSchema), async (req, res, next) => {
    try {
      const session = await service.getInterview(getAuth(req).org, req.params.id)
      res.status(200).json(session)
    } catch (err) {
      next(err)
    }
  })

  router.get('/:id/question', validateParams(idParamsSchema), async (req, res, next) => {
    try {
      const question = await service.getNextQuestion(getAuth(req).org, req.params.id)
      res.status(200).json({ question })
    } catch (err) {
      next(err)
    }
  })

  router.post(
    '/:id/answer',
    validateParams(idParamsSchema),
    validateBody(submitAnswerSchema),
    async (req, res, next) => {
      try {
        const evaluation = await service.submitAnswer(
          getAuth(req).org,
          req.params.id,
          req.body.questionId,
          req.body.text
        )
        res.status(201).json({ evaluation })
      } catch (err) {
        next(err)
      }
    }
  )

  router.get('/:id/report', validateParams(idParamsSchema), async (req, res, next) => {
    try {
      const report = await service.getReport(getAuth(req).org, req.params.id)
      res.status(200).json(report)
    } catch (err) {
      next(err)
    }
  })

  return router
}
