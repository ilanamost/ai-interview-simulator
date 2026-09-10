import { vi } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { createApp } from '../app.js'
import { createAuthService } from '../services/auth.service.js'
import { createPasswordService } from '../services/auth/password.service.js'
import { createTokenService, type TokenService } from '../services/auth/token.service.js'
import type { InterviewService } from '../services/interview.service.js'
import {
  createInMemorySessionRepository,
  createInMemoryUserRepository
} from './in-memory-auth-repositories.js'

export const ORG = 'default'
export const ACCESS_SECRET = 'test-access-secret'
export const REFRESH_SECRET = 'test-refresh-secret'
export const PASSWORD = 'correct-horse-battery'

export function makeInterviewService(overrides: Partial<InterviewService> = {}): InterviewService {
  return {
    startInterview: vi.fn(),
    getInterview: vi.fn(),
    listInterviews: vi.fn(),
    getNextQuestion: vi.fn(),
    submitAnswer: vi.fn(),
    getReport: vi.fn(),
    ...overrides
  } as unknown as InterviewService
}

export interface HarnessOptions {
  interviewService?: InterviewService
  /** The org every signup in this harness lands in. */
  org?: string
  accessTtlMin?: number
  refreshTtlDays?: number
  /**
   * Mirrors server.ts's `NODE_ENV === 'production'`. Drives both `Secure` and
   * `SameSite` on the auth cookies — see utils/auth-cookie.ts.
   */
  cookieSecure?: boolean
}

export interface Harness {
  app: Express
  tokens: TokenService
  interviewService: InterviewService
  userRepository: ReturnType<typeof createInMemoryUserRepository>
  sessionRepository: ReturnType<typeof createInMemorySessionRepository>
}

/**
 * A real app wired to real auth (real JWTs, real bcrypt at a cheap cost) over
 * in-memory repositories, so HTTP tests exercise the actual middleware chain
 * instead of a mock of it. The interview service stays a stub — it is not what
 * these tests are about.
 */
export function buildHarness(options: HarnessOptions = {}): Harness {
  const tokens = createTokenService({
    accessSecret: ACCESS_SECRET,
    refreshSecret: REFRESH_SECRET,
    accessTtlMin: options.accessTtlMin ?? 15,
    refreshTtlDays: options.refreshTtlDays ?? 30
  })
  const userRepository = createInMemoryUserRepository()
  const sessionRepository = createInMemorySessionRepository()
  const interviewService = options.interviewService ?? makeInterviewService()

  const authService = createAuthService({
    userRepository,
    sessionRepository,
    // Cost 4 rather than the production 12: same algorithm, a suite that finishes.
    passwords: createPasswordService(4),
    tokens,
    org: options.org ?? ORG
  })

  const app = createApp({
    interviewService,
    authService,
    tokens,
    corsOrigin: 'http://localhost:5173',
    cookieSecure: options.cookieSecure ?? false
  })

  return { app, tokens, interviewService, userRepository, sessionRepository }
}

export interface SignupOverrides {
  email?: string
  name?: string
  password?: string
}

/** A supertest agent carries the auth cookies forward, exactly like a browser. */
export function agentFor(app: Express) {
  return request.agent(app)
}

export async function signUp(app: Express, overrides: SignupOverrides = {}) {
  const agent = agentFor(app)
  const res = await agent.post('/api/auth/signup').send({
    email: 'ada@example.com',
    name: 'Ada Lovelace',
    password: PASSWORD,
    ...overrides
  })
  return { agent, res }
}

/** Reads a Set-Cookie header value by cookie name, or undefined when absent. */
export function cookieHeader(res: request.Response, name: string): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined
  return raw?.find(entry => entry.startsWith(`${name}=`))
}

/** The raw cookie value, for tests that need to replay or tamper with a token. */
export function cookieValue(res: request.Response, name: string): string | undefined {
  const entry = cookieHeader(res, name)
  return entry?.split(';')[0]?.slice(name.length + 1)
}
