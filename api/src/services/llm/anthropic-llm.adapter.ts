import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { AppError } from '../../utils/app-error.js'
import { logger } from '../../utils/logger.js'
import type {
  EvaluateAnswerInput,
  GenerateBaseQuestionInput,
  GenerateFollowUpInput,
  GeneratedEvaluation,
  GeneratedQuestion,
  LlmAdapter
} from './llm.adapter.js'

const questionSchema = z.object({
  text: z.string().min(1),
  topic: z.string().min(1),
  keywords: z.array(z.string().min(1)).min(1).max(6)
})

const evaluationSchema = z.object({
  grade: z.number().int(),
  summary: z.string().min(1),
  strengths: z.array(z.string().min(1)).max(4),
  improvements: z.array(z.string().min(1)).max(4),
  needsFollowUp: z.boolean()
})

function clampGrade(grade: number): number {
  return Math.max(0, Math.min(100, Math.round(grade)))
}

/** Haiku 4.5 rejects `output_config.effort` outright; every other allowlisted model accepts it. */
const NO_EFFORT_MODELS = new Set(['claude-haiku-4-5'])

/** Builds output_config, omitting `effort` for models that don't support the parameter at all. */
function outputConfig<T extends z.ZodTypeAny>(model: string, schema: T, effort: 'low' | 'medium') {
  const format = zodOutputFormat(schema)
  return NO_EFFORT_MODELS.has(model) ? { format } : { format, effort }
}

/** Wraps every provider failure (auth, rate limit, network, refusal) into the stable error shape. */
async function callModel<T>(operation: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (err) {
    logger.error('LLM call failed', {
      operation,
      error: err instanceof Error ? err.message : String(err)
    })
    throw AppError.upstreamUnavailable(
      'The interview assistant is temporarily unavailable. Please try again.'
    )
  }
}

export interface AnthropicLlmAdapterOptions {
  apiKey: string
  questionModel: string
  evalModel: string
}

export function createAnthropicLlmAdapter(options: AnthropicLlmAdapterOptions): LlmAdapter {
  const client = new Anthropic({ apiKey: options.apiKey })

  function describeCandidate(config: GenerateBaseQuestionInput['config']): string {
    const base = `a ${config.level} ${config.jobTitle} candidate in a ${config.type} interview`
    return config.jobDescription
      ? `${base}. Tailor questions to this job description when relevant:\n${config.jobDescription}`
      : base
  }

  return {
    async generateBaseQuestion(input: GenerateBaseQuestionInput): Promise<GeneratedQuestion> {
      const model = input.config.model ?? options.questionModel
      const response = await callModel('generateBaseQuestion', () =>
        client.messages.parse({
          model,
          max_tokens: 1024,
          output_config: outputConfig(model, questionSchema, 'low'),
          system: `You are an experienced interviewer questioning ${describeCandidate(input.config)}.`,
          messages: [
            {
              role: 'user',
              content:
                `Ask the next interview question.\n` +
                `Topics already covered: ${input.askedTopics.length ? input.askedTopics.join(', ') : 'none yet'}.\n` +
                `Do not repeat a topic already covered. Return one question that requires a substantive answer, ` +
                `a short topic label, and 3-6 keywords/concepts a strong answer should touch on.`
            }
          ]
        })
      )

      if (response.stop_reason === 'refusal' || !response.parsed_output) {
        throw AppError.upstreamUnavailable(
          'The interview assistant could not generate a question. Please try again.'
        )
      }

      return {
        text: response.parsed_output.text,
        topic: response.parsed_output.topic,
        keywords: response.parsed_output.keywords
      }
    },

    async generateFollowUp(input: GenerateFollowUpInput): Promise<GeneratedQuestion> {
      const model = input.config.model ?? options.questionModel
      const response = await callModel('generateFollowUp', () =>
        client.messages.parse({
          model,
          max_tokens: 1024,
          output_config: outputConfig(model, questionSchema, 'low'),
          system: `You are an experienced interviewer questioning ${describeCandidate(input.config)}.`,
          messages: [
            {
              role: 'user',
              content:
                `The candidate was just asked (topic: ${input.question.topic}): "${input.question.text}"\n` +
                `Their answer: "${input.answerText}"\n\n` +
                `The answer left a gap. Ask exactly one focused follow-up question that drills into the weakest ` +
                `part of their answer. Keep the topic the same, and list keywords a strong follow-up answer ` +
                `should touch on.`
            }
          ]
        })
      )

      if (response.stop_reason === 'refusal' || !response.parsed_output) {
        throw AppError.upstreamUnavailable(
          'The interview assistant could not generate a follow-up. Please try again.'
        )
      }

      return {
        text: response.parsed_output.text,
        topic: response.parsed_output.topic,
        keywords: response.parsed_output.keywords
      }
    },

    async evaluateAnswer(input: EvaluateAnswerInput): Promise<GeneratedEvaluation> {
      const model = input.config.model ?? options.evalModel
      const response = await callModel('evaluateAnswer', () =>
        client.messages.parse({
          model,
          max_tokens: 1024,
          output_config: outputConfig(model, evaluationSchema, 'medium'),
          system: `You are grading one interview answer from ${describeCandidate(input.config)}.`,
          messages: [
            {
              role: 'user',
              content:
                `Question (topic: ${input.question.topic}, isFollowUp: ${input.question.isFollowUp}): "${input.question.text}"\n` +
                `Candidate's answer: "${input.answerText}"\n\n` +
                `Score the answer from 0 to 100 using this rubric: coverage of the concepts the question tests ` +
                `(~45%), depth appropriate for a ${input.config.level} candidate (~30%), and use of reasoning, ` +
                `concrete examples, or tradeoffs (~25%). Grade an empty or non-attempt answer 0. Provide a ` +
                `one-sentence summary, up to 3 strengths, up to 3 improvements, and set needsFollowUp to true ` +
                `only if the score is below 70 and this question is not itself a follow-up.`
            }
          ]
        })
      )

      if (response.stop_reason === 'refusal' || !response.parsed_output) {
        throw AppError.upstreamUnavailable(
          'The interview assistant could not evaluate this answer. Please try again.'
        )
      }

      return {
        grade: clampGrade(response.parsed_output.grade),
        summary: response.parsed_output.summary,
        strengths: response.parsed_output.strengths,
        improvements: response.parsed_output.improvements,
        // A follow-up never earns its own follow-up (.doc/glossary.md); never trust the model on this invariant.
        needsFollowUp: input.question.isFollowUp ? false : response.parsed_output.needsFollowUp
      }
    }
  }
}
