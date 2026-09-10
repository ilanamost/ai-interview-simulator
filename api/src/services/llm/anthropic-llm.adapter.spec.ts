import { describe, expect, it, vi, beforeEach } from 'vitest'

const parseMock = vi.fn()

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { parse: parseMock }
  }
}))

const { createAnthropicLlmAdapter } = await import('./anthropic-llm.adapter.js')

const OPTIONS = {
  apiKey: 'test-key',
  questionModel: 'claude-sonnet-5',
  evalModel: 'claude-sonnet-5'
}

beforeEach(() => {
  parseMock.mockReset()
})

describe('createAnthropicLlmAdapter', () => {
  describe('generateBaseQuestion', () => {
    it('maps the parsed output to a GeneratedQuestion', async () => {
      parseMock.mockResolvedValue({
        stop_reason: 'end_turn',
        parsed_output: { text: 'Explain X', topic: 'Rendering', keywords: ['state', 'render'] }
      })
      const adapter = createAnthropicLlmAdapter(OPTIONS)

      const result = await adapter.generateBaseQuestion({
        config: { jobTitle: 'frontend', level: 'mid', type: 'technical', questionCount: 3 },
        askedTopics: []
      })

      expect(result).toEqual({
        text: 'Explain X',
        topic: 'Rendering',
        keywords: ['state', 'render']
      })
    })

    it('wraps a refusal into an upstream-unavailable AppError instead of returning garbage', async () => {
      parseMock.mockResolvedValue({ stop_reason: 'refusal', parsed_output: null })
      const adapter = createAnthropicLlmAdapter(OPTIONS)

      await expect(
        adapter.generateBaseQuestion({
          config: { jobTitle: 'frontend', level: 'mid', type: 'technical', questionCount: 3 },
          askedTopics: []
        })
      ).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE', status: 502 })
    })

    it('uses the model selected for the interview', async () => {
      parseMock.mockResolvedValue({
        stop_reason: 'end_turn',
        parsed_output: { text: 'Explain X', topic: 'Rendering', keywords: ['state'] }
      })
      const adapter = createAnthropicLlmAdapter(OPTIONS)

      await adapter.generateBaseQuestion({
        config: {
          jobTitle: 'frontend',
          level: 'mid',
          type: 'technical',
          questionCount: 3,
          model: 'claude-opus-5'
        },
        askedTopics: []
      })

      expect(parseMock).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-opus-5' }))
    })

    it('falls back to the configured model when no interview model is specified', async () => {
      parseMock.mockResolvedValue({
        stop_reason: 'end_turn',
        parsed_output: { text: 'Explain X', topic: 'Rendering', keywords: ['state'] }
      })
      const adapter = createAnthropicLlmAdapter({ ...OPTIONS, questionModel: 'claude-haiku-4-5' })

      await adapter.generateBaseQuestion({
        config: { jobTitle: 'frontend', level: 'mid', type: 'technical', questionCount: 3 },
        askedTopics: []
      })

      expect(parseMock).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-haiku-4-5' }))
    })

    it('omits output_config.effort for claude-haiku-4-5, which rejects the parameter outright', async () => {
      parseMock.mockResolvedValue({
        stop_reason: 'end_turn',
        parsed_output: { text: 'Explain X', topic: 'Rendering', keywords: ['state'] }
      })
      const adapter = createAnthropicLlmAdapter(OPTIONS)

      await adapter.generateBaseQuestion({
        config: {
          jobTitle: 'frontend',
          level: 'mid',
          type: 'technical',
          questionCount: 3,
          model: 'claude-haiku-4-5'
        },
        askedTopics: []
      })

      const call = parseMock.mock.calls[0][0]
      expect(call.output_config).not.toHaveProperty('effort')
    })

    it('still sets output_config.effort for models that support it', async () => {
      parseMock.mockResolvedValue({
        stop_reason: 'end_turn',
        parsed_output: { text: 'Explain X', topic: 'Rendering', keywords: ['state'] }
      })
      const adapter = createAnthropicLlmAdapter(OPTIONS)

      await adapter.generateBaseQuestion({
        config: {
          jobTitle: 'frontend',
          level: 'mid',
          type: 'technical',
          questionCount: 3,
          model: 'claude-opus-5'
        },
        askedTopics: []
      })

      const call = parseMock.mock.calls[0][0]
      expect(call.output_config.effort).toBe('low')
    })

    it('wraps a network/API failure without leaking the underlying error message', async () => {
      parseMock.mockRejectedValue(new Error('connection reset, api key was sk-abc123'))
      const adapter = createAnthropicLlmAdapter(OPTIONS)

      const promise = adapter.generateBaseQuestion({
        config: { jobTitle: 'frontend', level: 'mid', type: 'technical', questionCount: 3 },
        askedTopics: []
      })

      await expect(promise).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' })
      await expect(promise).rejects.not.toThrow(/sk-abc123/)
    })
  })

  describe('evaluateAnswer', () => {
    it('clamps an out-of-range grade into 0-100', async () => {
      parseMock.mockResolvedValue({
        stop_reason: 'end_turn',
        parsed_output: {
          grade: 142,
          summary: 's',
          strengths: [],
          improvements: [],
          needsFollowUp: false
        }
      })
      const adapter = createAnthropicLlmAdapter(OPTIONS)

      const result = await adapter.evaluateAnswer({
        config: { jobTitle: 'frontend', level: 'mid', type: 'technical', questionCount: 3 },
        question: { id: 'q1', text: 'Q', topic: 'T', isFollowUp: false, keywords: [] },
        answerText: 'answer'
      })

      expect(result.grade).toBe(100)
    })

    it('grades using the model selected for the interview', async () => {
      parseMock.mockResolvedValue({
        stop_reason: 'end_turn',
        parsed_output: {
          grade: 70,
          summary: 's',
          strengths: [],
          improvements: [],
          needsFollowUp: false
        }
      })
      const adapter = createAnthropicLlmAdapter(OPTIONS)

      await adapter.evaluateAnswer({
        config: {
          jobTitle: 'frontend',
          level: 'mid',
          type: 'technical',
          questionCount: 3,
          model: 'claude-haiku-4-5'
        },
        question: { id: 'q1', text: 'Q', topic: 'T', isFollowUp: false, keywords: [] },
        answerText: 'answer'
      })

      expect(parseMock).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-haiku-4-5' }))
    })

    it('omits output_config.effort when grading with claude-haiku-4-5', async () => {
      parseMock.mockResolvedValue({
        stop_reason: 'end_turn',
        parsed_output: {
          grade: 70,
          summary: 's',
          strengths: [],
          improvements: [],
          needsFollowUp: false
        }
      })
      const adapter = createAnthropicLlmAdapter(OPTIONS)

      await adapter.evaluateAnswer({
        config: {
          jobTitle: 'frontend',
          level: 'mid',
          type: 'technical',
          questionCount: 3,
          model: 'claude-haiku-4-5'
        },
        question: { id: 'q1', text: 'Q', topic: 'T', isFollowUp: false, keywords: [] },
        answerText: 'answer'
      })

      const call = parseMock.mock.calls[0][0]
      expect(call.output_config).not.toHaveProperty('effort')
    })

    it('never lets a follow-up question earn its own follow-up, regardless of what the model returns', async () => {
      parseMock.mockResolvedValue({
        stop_reason: 'end_turn',
        parsed_output: {
          grade: 20,
          summary: 's',
          strengths: [],
          improvements: [],
          needsFollowUp: true
        }
      })
      const adapter = createAnthropicLlmAdapter(OPTIONS)

      const result = await adapter.evaluateAnswer({
        config: { jobTitle: 'frontend', level: 'mid', type: 'technical', questionCount: 3 },
        question: {
          id: 'q1-f',
          text: 'Q',
          topic: 'T',
          isFollowUp: true,
          parentId: 'q1',
          keywords: []
        },
        answerText: 'answer'
      })

      expect(result.needsFollowUp).toBe(false)
    })
  })
})
