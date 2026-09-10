import { createApp } from './app.js'
import { loadEnv } from './config/env.js'
import { createPool } from './db/pool.js'
import { createInterviewRepository } from './repositories/interview.repository.js'
import { createUserRepository } from './repositories/user.repository.js'
import { createUserSessionRepository } from './repositories/user-session.repository.js'
import { createAnthropicLlmAdapter } from './services/llm/anthropic-llm.adapter.js'
import { createAuthService } from './services/auth.service.js'
import { createPasswordService } from './services/auth/password.service.js'
import { createTokenService } from './services/auth/token.service.js'
import { createInterviewService } from './services/interview.service.js'
import { logger } from './utils/logger.js'

const env = loadEnv()

const pool = createPool(env.DATABASE_URL)
const repository = createInterviewRepository(pool)
const llm = createAnthropicLlmAdapter({
  apiKey: env.ANTHROPIC_API_KEY,
  questionModel: env.LLM_QUESTION_MODEL,
  evalModel: env.LLM_EVAL_MODEL
})
const interviewService = createInterviewService({ repository, llm })

const tokens = createTokenService({
  accessSecret: env.JWT_ACCESS_SECRET,
  refreshSecret: env.JWT_REFRESH_SECRET,
  accessTtlMin: env.ACCESS_TOKEN_TTL_MIN,
  refreshTtlDays: env.REFRESH_TOKEN_TTL_DAYS
})
const authService = createAuthService({
  userRepository: createUserRepository(pool),
  sessionRepository: createUserSessionRepository(pool),
  passwords: createPasswordService(),
  tokens,
  // Still single-org: every signup lands in ORG_ID, and from then on org travels
  // on the access token rather than being read per request from the environment.
  org: env.ORG_ID
})

const app = createApp({
  interviewService,
  authService,
  tokens,
  corsOrigin: env.CORS_ORIGIN,
  cookieSecure: env.NODE_ENV === 'production'
})

app.listen(env.PORT, () => {
  logger.info(`interview-api listening on port ${env.PORT}`, { operation: 'startup' })
})

process.on('SIGTERM', () => {
  void pool.end()
})
