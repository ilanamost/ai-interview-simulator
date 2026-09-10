import { z } from 'zod'

/**
 * All configuration is loaded from environment variables (.rule/security-rules.md:
 * secrets from env only, never hardcoded). Validated once at startup so a missing
 * secret fails fast instead of surfacing as a confusing runtime error later.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required'),
  // Signing keys for the auth cookies. No default on purpose: a fallback secret
  // would silently make every token forgeable (.rule/security-rules.md).
  JWT_ACCESS_SECRET: z.string().min(1, 'JWT_ACCESS_SECRET is required'),
  JWT_REFRESH_SECRET: z.string().min(1, 'JWT_REFRESH_SECRET is required'),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  /** The org every signup lands in — the app is still single-org. */
  ORG_ID: z.string().min(1).default('default'),
  LLM_QUESTION_MODEL: z.string().min(1).default('claude-sonnet-5'),
  LLM_EVAL_MODEL: z.string().min(1).default('claude-sonnet-5'),
  CORS_ORIGIN: z.string().min(1).default('http://localhost:5173')
})

export type Env = z.infer<typeof envSchema>

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source)
  if (!parsed.success) {
    const details = parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`)
    throw new Error(`Invalid environment configuration:\n${details.join('\n')}`)
  }
  return parsed.data
}
