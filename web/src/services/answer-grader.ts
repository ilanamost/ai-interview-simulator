import type { Evaluation, ExperienceLevel, Grade, Question } from '@/types/interview'

/**
 * Rule-based, fully deterministic grader standing in for the Stage 2 LLM.
 * Same answer always yields the same evaluation, which keeps tests stable
 * (.rule/testing-rules.md: freeze randomness).
 */

/** Word count a complete answer is expected to reach, by level. */
const EXPECTED_WORDS: Record<ExperienceLevel, number> = {
  junior: 40,
  mid: 70,
  senior: 100
}

/** An answer scoring below this gets a follow-up question. */
export const FOLLOW_UP_THRESHOLD = 70

const REASONING = /\b(because|since|so that|therefore|which means|the reason|that way)\b/
const EXAMPLE = /\b(for example|for instance|e\.g\.|in my last|we had|i once|at my|last year)\b/
const TRADEOFF = /\b(however|downside|instead|versus|tradeoff|trade-off|on the other hand|the cost)\b/

const WEIGHT = { coverage: 45, depth: 30, structure: 25 }

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function countWords(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

/** Keywords may be phrases, so match on the raw lowercased text rather than tokens. */
function findMissedKeywords(question: Question, normalized: string): string[] {
  return question.keywords.filter(keyword => !normalized.includes(keyword.toLowerCase()))
}

export interface GradeBreakdown {
  grade: Grade
  coverage: number
  depth: number
  structure: number
  missedKeywords: string[]
}

export function scoreAnswer(
  question: Question,
  answerText: string,
  level: ExperienceLevel
): GradeBreakdown {
  const normalized = answerText.toLowerCase()
  const words = countWords(answerText)

  if (words === 0) {
    return { grade: 0, coverage: 0, depth: 0, structure: 0, missedKeywords: [...question.keywords] }
  }

  const missedKeywords = findMissedKeywords(question, normalized)
  const total = question.keywords.length
  const coverage = total === 0 ? 1 : (total - missedKeywords.length) / total

  const depth = clamp01(words / EXPECTED_WORDS[level])

  const signals = [REASONING, EXAMPLE, TRADEOFF].filter(pattern => pattern.test(normalized)).length
  const structure = signals / 3

  const grade = Math.round(
    coverage * WEIGHT.coverage + depth * WEIGHT.depth + structure * WEIGHT.structure
  )

  return { grade, coverage, depth, structure, missedKeywords }
}

function buildStrengths(breakdown: GradeBreakdown): string[] {
  const strengths: string[] = []
  if (breakdown.coverage >= 0.6) strengths.push('Covered most of the concepts this question is after.')
  if (breakdown.depth >= 0.8) strengths.push('Answered at a length that leaves room for real detail.')
  if (breakdown.structure >= 0.67) strengths.push('Backed the answer with reasoning, examples, and tradeoffs.')
  if (strengths.length === 0) strengths.push('Made a direct attempt at the question rather than deflecting.')
  return strengths
}

function buildImprovements(breakdown: GradeBreakdown): string[] {
  const improvements: string[] = []

  if (breakdown.missedKeywords.length > 0) {
    const shown = breakdown.missedKeywords.slice(0, 4).join(', ')
    improvements.push(`Did not touch on: ${shown}.`)
  }
  if (breakdown.depth < 0.6) {
    improvements.push('Too brief for this level — expand on the how, not just the what.')
  }
  if (!breakdown.structure) {
    improvements.push('Add a concrete example and say why you would make that choice.')
  } else if (breakdown.structure < 0.67) {
    improvements.push('Name the tradeoff you are accepting, not only the option you picked.')
  }

  return improvements
}

function buildSummary(grade: Grade): string {
  if (grade === 0) return 'No answer was given, so there is nothing to assess here.'
  if (grade >= 85) return 'Strong answer: on target, specific, and well reasoned.'
  if (grade >= 70) return 'Solid answer that covers the main ground, with room to go deeper.'
  if (grade >= 50) return 'Partial answer — the direction is right but key points are missing.'
  return 'Weak answer: it misses most of what this question is testing.'
}

export function evaluateAnswerText(
  question: Question,
  answerText: string,
  level: ExperienceLevel
): Evaluation {
  const breakdown = scoreAnswer(question, answerText, level)

  return {
    questionId: question.id,
    grade: breakdown.grade,
    summary: buildSummary(breakdown.grade),
    strengths: buildStrengths(breakdown),
    improvements: buildImprovements(breakdown),
    // A follow-up only makes sense on a base question; we never drill into a drill-down.
    needsFollowUp: breakdown.grade < FOLLOW_UP_THRESHOLD && !question.isFollowUp
  }
}
