import { describe, expect, it } from 'vitest'
import { createInterviewRepository } from './interview.repository.js'
import { buildReport } from '../services/interview.service.js'
import type { ListInterviewQuery } from './interview.repository.js'
import type { Queryable } from '../db/types.js'
import type { Evaluation, InterviewConfig, InterviewSession } from '../types/interview.js'

/*
 * QA adversarial pass on the one number the list and the detail view must agree on.
 *
 * The list computes overallGrade in SQL (`avg(grade)` -> numeric string -> Math.round);
 * the detail view computes it in JS (`buildReport`: sum / count -> Math.round). Two
 * different arithmetics on two different machines. interview.repository.spec.ts checks
 * five hand-picked grade sets; this fuzzes the whole space that can occur, and models
 * Postgres `numeric` exactly rather than reusing the same JS double the code under test
 * would use (which would make the comparison circular).
 */

const ORG = 'default'

function makeConfig(): InterviewConfig {
  return { jobTitle: 'backend', level: 'senior', type: 'technical', questionCount: 5 }
}

function makeDb(handler: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }>) {
  const calls: Array<{ sql: string; params: unknown[] }> = []
  const db = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params })
      return handler(sql, params)
    }
  } as unknown as Queryable
  return { db, calls }
}

/**
 * What Postgres `avg(int)` actually returns: an exact decimal, not a float. Computed
 * with BigInt so no double ever touches it — if the repository's Number()/Math.round()
 * disagreed with buildReport's float division, this is what would expose it.
 */
function pgAvg(grades: number[], scale = 20): string {
  const total = grades.reduce((sum, g) => sum + BigInt(g), 0n)
  const count = BigInt(grades.length)
  const scaled = (total * 10n ** BigInt(scale)) / count
  const whole = scaled / 10n ** BigInt(scale)
  const frac = (scaled % 10n ** BigInt(scale)).toString().padStart(scale, '0')
  return `${whole}.${frac}`
}

function summaryRow(avgGrade: string | number) {
  return {
    id: 'i1',
    job_title: 'backend',
    level: 'senior',
    type: 'technical',
    job_description: null,
    question_count: 5,
    model: null,
    created_at: new Date('2026-07-18T10:00:00.000Z'),
    avg_grade: avgGrade
  }
}

function sessionFor(grades: number[]): InterviewSession {
  const evaluations: Evaluation[] = grades.map((grade, i) => ({
    questionId: `q${i}`,
    grade,
    summary: 's',
    strengths: [],
    improvements: [],
    // Half of them are follow-ups: buildReport averages both kinds, so the list must too.
    needsFollowUp: i % 2 === 0
  }))

  return {
    id: 'i1',
    config: makeConfig(),
    createdAt: '2026-07-18T10:00:00.000Z',
    asked: [],
    answers: [],
    evaluations
  }
}

async function listedGrade(grades: number[]): Promise<number> {
  const { db } = makeDb(async (sql: string) =>
    sql.includes('count(distinct')
      ? { rows: [{ count: '1' }] }
      : { rows: [summaryRow(pgAvg(grades))] }
  )
  const { items } = await createInterviewRepository(db).listInterviews(ORG)
  return items[0].overallGrade
}

/** Deterministic pseudo-random, so a failure is reproducible rather than a flake. */
function makeRandom(seed: number) {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state / 2147483648
  }
}

describe('the list grade is the same number the report shows', () => {
  it('agrees with buildReport on every evaluation count from 1 to 20, at every half-point', async () => {
    // The dangerous inputs are exact .5 averages: JS rounds half away from zero,
    // and a numeric that rendered as .4999... would round the other way.
    for (let count = 1; count <= 20; count++) {
      for (const base of [0, 41, 74, 99]) {
        const grades = Array.from({ length: count }, (_, i) => (i % 2 === 0 ? base : base + 1))

        expect(await listedGrade(grades)).toBe(buildReport(sessionFor(grades)).overallGrade)
      }
    }
  })

  it('agrees with buildReport across 300 random grade sets', async () => {
    const random = makeRandom(20260814)

    for (let i = 0; i < 300; i++) {
      const count = 1 + Math.floor(random() * 20)
      const grades = Array.from({ length: count }, () => Math.floor(random() * 101))

      const listed = await listedGrade(grades)
      const reported = buildReport(sessionFor(grades)).overallGrade

      expect(
        listed,
        `grades ${JSON.stringify(grades)} listed as ${listed}, reported as ${reported}`
      ).toBe(reported)
    }
  })

  it.each([
    ['the floor of the scale', [0]],
    ['the ceiling of the scale', [100]],
    ['every grade zero', [0, 0, 0]],
    ['every grade full marks', [100, 100, 100, 100]],
    ['a three-way repeating average', [1, 1, 2]],
    ['a seven-way repeating average', [10, 20, 30, 40, 50, 60, 71]],
    ['the widest possible spread', [0, 100]]
  ])('agrees with buildReport on %s', async (_label, grades) => {
    expect(await listedGrade(grades)).toBe(buildReport(sessionFor(grades)).overallGrade)
  })

  it('reads the numeric string pg actually sends, not a pre-parsed number', async () => {
    // node-postgres returns avg() as a string; a change that assumed a number would
    // still pass a test that only ever fed it numbers.
    const { db } = makeDb(async () => ({ rows: [summaryRow('82.5000000000000000')] }))
    const { items } = await createInterviewRepository(db).listInterviews(ORG)

    expect(items[0].overallGrade).toBe(83)
    expect(typeof items[0].overallGrade).toBe('number')
  })
})

describe('the membership rule has no second line of defence', () => {
  /** The page query — the one that carries the join, the aggregate and the window. */
  function capturedSql() {
    const { db, calls } = makeDb(async () => ({ rows: [] }))
    return createInterviewRepository(db)
      .listInterviews(ORG)
      .then(() => calls.filter(c => c.sql.includes('avg(e.grade) as avg_grade'))[0].sql)
  }

  it('joins evaluation inline, so a zero-evaluation interview cannot be in the result set', async () => {
    const sql = await capturedSql()

    expect(sql).toMatch(/join\s+evaluation\s+e\s+on\s+e\.interview_id\s*=\s*i\.id/)
    expect(sql.toLowerCase()).not.toContain('left join')
    expect(sql.toLowerCase()).not.toContain('outer join')
  })

  it('joins evaluation and not answer, so an answered-but-ungraded interview stays out', async () => {
    const sql = await capturedSql()

    // Joining `answer` would admit interviews the LLM never graded — which
    // GET /:id/report still refuses with NO_EVALUATION, giving a row that opens
    // onto an error page.
    expect(sql).not.toContain('join answer')
    expect(sql).not.toContain('join question')
  })

  it('scopes the joined evaluations to the same org as the interview', async () => {
    const sql = await capturedSql()

    expect(sql).toContain('e.org = i.org')
  })

  it('aggregates per interview rather than emitting one row per evaluation', async () => {
    const sql = await capturedSql()

    expect(sql).toContain('group by i.id')
    expect(sql).toContain('avg(e.grade)')
  })

  it('applies no evaluation-side predicate that getInterview does not also apply', async () => {
    // getInterview loads every evaluation for the interview, unfiltered. Any extra
    // predicate here (is_follow_up, a grade floor, a soft-delete column) would make
    // the list average a different set than the report averages.
    const sql = await capturedSql()

    expect(sql).not.toContain('e.is_follow_up')
    expect(sql).not.toContain('e.deleted_at')
    expect(sql).not.toContain('having')
  })

  /**
   * Documents the fragility the inner join is protecting: nothing downstream would
   * catch a null aggregate. `Math.round(Number(null))` is 0 — a zero-evaluation
   * interview would silently list as a grade-0 report rather than being excluded.
   */
  it('would produce a nonsense grade, not an error, if a null aggregate ever reached it', async () => {
    const { db } = makeDb(async () => ({ rows: [summaryRow(null as unknown as string)] }))

    const { items } = await createInterviewRepository(db).listInterviews(ORG)

    expect(items[0].overallGrade).toBe(0)
  })
})

/*
 * Plan 018 bolted a window onto that same query. These assert that paging was added
 * WITHOUT disturbing anything above: same inner join, same grouping, same org scoping,
 * with `order by ... limit ... offset` layered on top of the whole filtered set.
 */
describe('paging did not disturb the membership query', () => {
  function capturedCalls(query: ListInterviewQuery = {}) {
    const { db, calls } = makeDb(async () => ({ rows: [] }))
    return createInterviewRepository(db)
      .listInterviews(ORG, query)
      .then(() => ({
        page: calls.filter(c => c.sql.includes('avg(e.grade) as avg_grade'))[0],
        count: calls.filter(c => c.sql.includes('count(distinct'))[0]
      }))
  }

  it('windows the page after the group and the order, never before either', async () => {
    const { page } = await capturedCalls({ sort: 'grade-asc', page: 2, pageSize: 10 })

    // `limit` ahead of `order by` would cut an arbitrary ten rows and then sort those
    // ten — every page would show rows that belong on a different one.
    expect(page.sql.indexOf('join evaluation')).toBeLessThan(page.sql.indexOf('group by i.id'))
    expect(page.sql.indexOf('group by i.id')).toBeLessThan(page.sql.indexOf('order by'))
    expect(page.sql.indexOf('order by')).toBeLessThan(page.sql.indexOf('limit'))
    expect(page.sql).toContain('order by round(avg(e.grade)) asc, i.created_at desc')
    expect(page.sql).toContain('limit $2 offset $3')
    expect(page.params).toEqual([ORG, 10, 10])
  })

  it('keeps the inner join, the grouping and the org scoping untouched under paging', async () => {
    const { page } = await capturedCalls({ page: 3, pageSize: 5, sort: 'grade-desc' })

    expect(page.sql).toMatch(/join\s+evaluation\s+e\s+on\s+e\.interview_id\s*=\s*i\.id/)
    expect(page.sql.toLowerCase()).not.toContain('left join')
    expect(page.sql).toContain('e.org = i.org')
    expect(page.sql).toContain('i.org = $1')
    expect(page.sql).toContain('i.deleted_at is null')
    expect(page.sql).toContain('group by i.id')
    expect(page.sql).not.toContain('having')
  })

  it('counts through the same join and org scoping, so total obeys the membership rule too', async () => {
    // A count that dropped the join would include never-answered interviews and
    // report more pages than the list can actually fill.
    const { count } = await capturedCalls({ page: 2 })

    expect(count.sql).toMatch(/join\s+evaluation\s+e\s+on\s+e\.interview_id\s*=\s*i\.id/)
    expect(count.sql.toLowerCase()).not.toContain('left join')
    expect(count.sql).toContain('e.org = i.org')
    expect(count.sql).toContain('i.org = $1')
    expect(count.sql).toContain('i.deleted_at is null')
    expect(count.sql).toContain('count(distinct i.id)')
    expect(count.params).toEqual([ORG])
  })

  it('never lets a page window narrow the total', async () => {
    const { count } = await capturedCalls({ page: 9, pageSize: 1 })

    expect(count.sql).not.toContain('limit')
    expect(count.sql).not.toContain('offset')
    expect(count.params).toEqual([ORG])
  })
})
