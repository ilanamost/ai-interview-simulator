import { DEFAULT_INTERVIEW_SORT, DEFAULT_PAGE_SIZE } from '../types/interview.js'
import type { Queryable } from '../db/types.js'
import type {
  Answer,
  Evaluation,
  ExperienceLevel,
  InterviewConfig,
  InterviewSession,
  InterviewSort,
  InterviewSummary,
  InterviewSummaryPage,
  InterviewType,
  JobTitle,
  Question
} from '../types/interview.js'

interface InterviewRow {
  id: string
  job_title: string
  level: string
  type: string
  job_description: string | null
  question_count: number
  model: string | null
  created_at: Date
}

/** `avg()` over an int column comes back from `pg` as a numeric string. */
interface InterviewSummaryRow extends InterviewRow {
  avg_grade: string | number
}

interface QuestionRow {
  id: string
  text: string
  topic: string
  is_follow_up: boolean
  parent_id: string | null
  keywords: string[]
}

interface AnswerRow {
  question_id: string
  text: string
  submitted_at: Date
}

interface EvaluationRow {
  question_id: string
  grade: number
  summary: string
  strengths: string[]
  improvements: string[]
  needs_follow_up: boolean
}

function toConfig(row: InterviewRow): InterviewConfig {
  return {
    jobTitle: row.job_title as InterviewConfig['jobTitle'],
    level: row.level as InterviewConfig['level'],
    type: row.type as InterviewConfig['type'],
    jobDescription: row.job_description ?? undefined,
    questionCount: row.question_count,
    // Rows written before the model column existed read back as "use the server default".
    model: (row.model as InterviewConfig['model']) ?? undefined
  }
}

function toQuestion(row: QuestionRow): Question {
  return {
    id: row.id,
    text: row.text,
    topic: row.topic,
    isFollowUp: row.is_follow_up,
    parentId: row.parent_id ?? undefined,
    keywords: row.keywords
  }
}

function toAnswer(row: AnswerRow): Answer {
  return {
    questionId: row.question_id,
    text: row.text,
    submittedAt: row.submitted_at.toISOString()
  }
}

function toSummary(row: InterviewSummaryRow): InterviewSummary {
  return {
    id: row.id,
    config: toConfig(row),
    createdAt: row.created_at.toISOString(),
    // Deliberately the same formula buildReport uses in services/interview.service.ts:
    // the simple mean of EVERY evaluation, base and follow-up alike, rounded once.
    // Changing either side without the other makes the list disagree with the detail view.
    overallGrade: Math.round(Number(row.avg_grade))
  }
}

function toEvaluation(row: EvaluationRow): Evaluation {
  return {
    questionId: row.question_id,
    grade: row.grade,
    summary: row.summary,
    strengths: row.strengths,
    improvements: row.improvements,
    needsFollowUp: row.needs_follow_up
  }
}

export interface CreateInterviewInput {
  id: string
  org: string
  config: InterviewConfig
}

/** Every field is optional and they combine with AND. */
export interface ListInterviewFilters {
  /** A `YYYY-MM-DD` calendar day, matched against `created_at` in UTC. */
  date?: string
  jobTitle?: JobTitle
  level?: ExperienceLevel
  type?: InterviewType
}

/** The filters, plus how to order the matches and which page of them to cut. */
export interface ListInterviewQuery extends ListInterviewFilters {
  /** Applied to the whole filtered set before the page; `date-desc` when omitted. */
  sort?: InterviewSort
  /** 1-based. The first page when omitted; a page past the end is empty, not an error. */
  page?: number
  /** `DEFAULT_PAGE_SIZE` when omitted. The route rejects anything outside [1, MAX_PAGE_SIZE]. */
  pageSize?: number
}

/**
 * The four orderings `sort` names, as fixed SQL fragments — a request value only ever
 * selects one of these, it is never interpolated into the statement.
 *
 * The grade orderings rank on `round(avg(e.grade))`, not the raw average: `toSummary`
 * rounds `avg_grade` into the `overallGrade` every client sorts on, and grades are
 * always in [0, 100] (`anthropic-llm.adapter.ts`'s `clampGrade`), so Postgres's
 * round-half-up agrees with `Math.round` there. Ranking on the unrounded average would
 * let two rows that display the same grade — common, since one evaluation's average is
 * rarely a whole number — come out in an order no client's `overallGrade` justifies,
 * breaking mock/http parity.
 *
 * Both grade orderings break a tie with the newer interview. That is load-bearing, not
 * cosmetic: `overallGrade` is a small integer, so ties are common, and without a total
 * order across the whole set a row can appear on two pages or on none. Mirrored by
 * `COMPARE` in web/src/services/report-history.service.ts.
 */
const ORDER_BY: Record<InterviewSort, string> = {
  'date-desc': 'i.created_at desc',
  'date-asc': 'i.created_at asc',
  'grade-desc': 'round(avg(e.grade)) desc, i.created_at desc',
  'grade-asc': 'round(avg(e.grade)) asc, i.created_at desc'
}

export interface AddQuestionInput {
  id: string
  interviewId: string
  org: string
  position: number
  question: Omit<Question, 'id'>
}

export interface AddAnswerInput {
  id: string
  interviewId: string
  org: string
  answer: Answer
}

export interface AddEvaluationInput {
  id: string
  answerId: string
  interviewId: string
  org: string
  evaluation: Evaluation
}

/** Every query is scoped by `org` (.rule/security-rules.md: enforce tenant isolation on every query). */
export function createInterviewRepository(db: Queryable) {
  return {
    async createInterview(input: CreateInterviewInput): Promise<InterviewSession> {
      const result = await db.query<InterviewRow>(
        `insert into interview (id, org, job_title, level, type, job_description, question_count, model)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         returning id, job_title, level, type, job_description, question_count, model, created_at`,
        [
          input.id,
          input.org,
          input.config.jobTitle,
          input.config.level,
          input.config.type,
          input.config.jobDescription ?? null,
          input.config.questionCount,
          input.config.model ?? null
        ]
      )
      const row = result.rows[0]
      return {
        id: row.id,
        config: toConfig(row),
        createdAt: row.created_at.toISOString(),
        asked: [],
        answers: [],
        evaluations: []
      }
    },

    async getInterview(id: string, org: string): Promise<InterviewSession | null> {
      const interviewResult = await db.query<InterviewRow>(
        `select id, job_title, level, type, job_description, question_count, model, created_at
         from interview where id = $1 and org = $2 and deleted_at is null`,
        [id, org]
      )
      const row = interviewResult.rows[0]
      if (!row) return null

      const [questions, answers, evaluations] = await Promise.all([
        db.query<QuestionRow>(
          `select id, text, topic, is_follow_up, parent_id, keywords
           from question where interview_id = $1 and org = $2 order by position asc`,
          [id, org]
        ),
        db.query<AnswerRow>(
          `select question_id, text, submitted_at
           from answer where interview_id = $1 and org = $2 order by submitted_at asc`,
          [id, org]
        ),
        db.query<EvaluationRow>(
          `select question_id, grade, summary, strengths, improvements, needs_follow_up
           from evaluation where interview_id = $1 and org = $2 order by created_at asc`,
          [id, org]
        )
      ])

      return {
        id: row.id,
        config: toConfig(row),
        createdAt: row.created_at.toISOString(),
        asked: questions.rows.map(toQuestion),
        answers: answers.rows.map(toAnswer),
        evaluations: evaluations.rows.map(toEvaluation)
      }
    },

    /**
     * One page of the interview history list. The join to `evaluation` is
     * deliberately an INNER join: an interview with zero evaluations has no report
     * to show, the same rule getReport already enforces with NO_EVALUATION, so it
     * must not appear here either.
     *
     * Ordering is applied to the whole filtered set BEFORE `limit`/`offset` — a page
     * ordered on its own would put the wrong rows on every page. Paging is
     * `limit`/`offset` rather than keyset: a row recorded between two page fetches
     * can be skipped or repeated, accepted knowingly (.plan/018) because history
     * changes rarely and never while a user is paging through it.
     */
    async listInterviews(
      org: string,
      query: ListInterviewQuery = {}
    ): Promise<InterviewSummaryPage> {
      const conditions = ['i.org = $1', 'i.deleted_at is null']
      const params: unknown[] = [org]

      const addCondition = (sql: (placeholder: string) => string, value: unknown): void => {
        params.push(value)
        conditions.push(sql(`$${params.length}`))
      }

      if (query.date !== undefined) {
        // Compare calendar days, not instants. `at time zone 'UTC'` pins the day
        // boundary to UTC — the same zone createdAt is serialized in — so the
        // result never depends on the database session's TimeZone setting.
        addCondition(p => `(i.created_at at time zone 'UTC')::date = ${p}::date`, query.date)
      }
      if (query.jobTitle !== undefined) addCondition(p => `i.job_title = ${p}`, query.jobTitle)
      if (query.level !== undefined) addCondition(p => `i.level = ${p}`, query.level)
      if (query.type !== undefined) addCondition(p => `i.type = ${p}`, query.type)

      // One where clause and one parameter list, shared by both statements, so the
      // count can never end up describing a different set than the page.
      const from = `from interview i
         join evaluation e on e.interview_id = i.id and e.org = i.org
         where ${conditions.join(' and ')}`
      const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE
      const page = query.page ?? 1

      const [pageResult, countResult] = await Promise.all([
        db.query<InterviewSummaryRow>(
          `select i.id, i.job_title, i.level, i.type, i.job_description, i.question_count,
                i.model, i.created_at, avg(e.grade) as avg_grade
         ${from}
         group by i.id
         order by ${ORDER_BY[query.sort ?? DEFAULT_INTERVIEW_SORT]}
         limit $${params.length + 1} offset $${params.length + 2}`,
          [...params, pageSize, (page - 1) * pageSize]
        ),
        // `distinct` because the join emits one row per evaluation; the page query
        // collapses those with `group by`, and the count has to collapse them too.
        db.query<{ count: string }>(`select count(distinct i.id) as count ${from}`, params)
      ])

      return {
        items: pageResult.rows.map(toSummary),
        total: Number(countResult.rows[0]?.count ?? 0)
      }
    },

    async countAskedBaseQuestions(interviewId: string, org: string): Promise<number> {
      const result = await db.query<{ count: string }>(
        `select count(*) as count from question
         where interview_id = $1 and org = $2 and is_follow_up = false`,
        [interviewId, org]
      )
      return Number(result.rows[0]?.count ?? 0)
    },

    async getLastQuestion(interviewId: string, org: string): Promise<Question | null> {
      const result = await db.query<QuestionRow>(
        `select id, text, topic, is_follow_up, parent_id, keywords
         from question where interview_id = $1 and org = $2
         order by position desc limit 1`,
        [interviewId, org]
      )
      const row = result.rows[0]
      return row ? toQuestion(row) : null
    },

    async getQuestion(questionId: string, org: string): Promise<Question | null> {
      const result = await db.query<QuestionRow>(
        `select id, text, topic, is_follow_up, parent_id, keywords
         from question where id = $1 and org = $2`,
        [questionId, org]
      )
      const row = result.rows[0]
      return row ? toQuestion(row) : null
    },

    async getEvaluationForQuestion(questionId: string, org: string): Promise<Evaluation | null> {
      const result = await db.query<EvaluationRow>(
        `select question_id, grade, summary, strengths, improvements, needs_follow_up
         from evaluation where question_id = $1 and org = $2`,
        [questionId, org]
      )
      const row = result.rows[0]
      return row ? toEvaluation(row) : null
    },

    async addQuestion(input: AddQuestionInput): Promise<Question> {
      const result = await db.query<QuestionRow>(
        `insert into question (id, interview_id, org, position, text, topic, is_follow_up, parent_id, keywords)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         returning id, text, topic, is_follow_up, parent_id, keywords`,
        [
          input.id,
          input.interviewId,
          input.org,
          input.position,
          input.question.text,
          input.question.topic,
          input.question.isFollowUp,
          input.question.parentId ?? null,
          JSON.stringify(input.question.keywords)
        ]
      )
      return toQuestion(result.rows[0])
    },

    async addAnswer(input: AddAnswerInput): Promise<Answer> {
      const result = await db.query<AnswerRow>(
        `insert into answer (id, question_id, interview_id, org, text, submitted_at)
         values ($1, $2, $3, $4, $5, $6)
         returning question_id, text, submitted_at`,
        [
          input.id,
          input.answer.questionId,
          input.interviewId,
          input.org,
          input.answer.text,
          input.answer.submittedAt
        ]
      )
      return toAnswer(result.rows[0])
    },

    async addEvaluation(input: AddEvaluationInput): Promise<Evaluation> {
      const result = await db.query<EvaluationRow>(
        `insert into evaluation (id, question_id, answer_id, interview_id, org, grade, summary, strengths, improvements, needs_follow_up)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         returning question_id, grade, summary, strengths, improvements, needs_follow_up`,
        [
          input.id,
          input.evaluation.questionId,
          input.answerId,
          input.interviewId,
          input.org,
          input.evaluation.grade,
          input.evaluation.summary,
          JSON.stringify(input.evaluation.strengths),
          JSON.stringify(input.evaluation.improvements),
          input.evaluation.needsFollowUp
        ]
      )
      return toEvaluation(result.rows[0])
    }
  }
}

export type InterviewRepository = ReturnType<typeof createInterviewRepository>
