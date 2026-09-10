import type { InterviewConfig, Question } from '../../types/interview.js'

/**
 * The contract every question/evaluation generator must satisfy. Kept
 * independent of the Anthropic SDK so the service layer and its tests never
 * depend on a concrete provider (.rule/coding-rules.md: define a source as
 * an interface, then implement it).
 */
export interface GeneratedQuestion {
  text: string
  topic: string
  keywords: string[]
}

export interface GeneratedEvaluation {
  grade: number
  summary: string
  strengths: string[]
  improvements: string[]
  needsFollowUp: boolean
}

export interface GenerateBaseQuestionInput {
  config: InterviewConfig
  askedTopics: string[]
}

export interface GenerateFollowUpInput {
  config: InterviewConfig
  question: Question
  answerText: string
}

export interface EvaluateAnswerInput {
  config: InterviewConfig
  question: Question
  answerText: string
}

export interface LlmAdapter {
  generateBaseQuestion(input: GenerateBaseQuestionInput): Promise<GeneratedQuestion>
  generateFollowUp(input: GenerateFollowUpInput): Promise<GeneratedQuestion>
  evaluateAnswer(input: EvaluateAnswerInput): Promise<GeneratedEvaluation>
}
