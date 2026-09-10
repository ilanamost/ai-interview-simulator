import { describe, expect, it } from 'vitest'
import { createInterviewRepository } from './interview.repository.js'
import type { ListInterviewQuery } from './interview.repository.js'
import type { Queryable } from '../db/types.js'

/*
 * QA adversarial pass (plan 018) on the ONE thing the plan names as its first risk:
 *
 *   "the four `sort` values must produce identical row order to today's client-side
 *    COMPARE map (including its grade-tie newest-first tiebreak) or a page boundary
 *    could show a duplicate or skipped row across pages"
 *
 * Every existing spec checks the two halves separately. interview.repository.spec.ts
 * asserts the exact `order by` TEXT; report-history.adversarial.spec.ts asserts mock/http
 * parity against a hand-written JS server that sorts on `overallGrade`. Neither one ever
 * makes the real SQL ordering and the real client ordering rank the same rows, so neither
 * can see them disagree.
 *
 * They do disagree. `ORDER BY` ranks on `avg(e.grade)` — the UNROUNDED average — while
 * `toSummary`, `Report.overallGrade`, `InterviewSummary.overallGrade` and the mock
 * source's `COMPARE` all rank on `Math.round(avg)`. Two interviews whose averages round
 * to the same displayed grade are a tie to every client and a strict ordering to Postgres.
 *
 * The fake db below is not a re-implementation of the ordering: it READS the `order by`
 * fragment the repository actually emitted and ranks rows the way Postgres would rank
 * them under that fragment. Emit `round(avg(e.grade))` and these tests go green on their
 * own; emit `avg(e.grade)` and they show which row lands on the wrong page.
 */

const ORG = 'default'

interface Seed {
  id: string
  /** What Postgres `avg(int)` returns: an exact decimal as a numeric string. */
  avgGrade: string
  createdAt: string
}

/**
 * Three interviews whose grades all DISPLAY as 81, because 80.5 rounds to 81. Nothing
 * exotic: an interview has one evaluation per answer, so a fractional average is the
 * ordinary case and an exactly-integral one is the rare one. `a` is the only one whose
 * average is already whole.
 */
const SEEDS: Seed[] = [
  { id: 'a', avgGrade: '81.0000000000000000', createdAt: '2026-08-09T10:00:00.000Z' },
  { id: 'b', avgGrade: '80.5000000000000000', createdAt: '2026-08-10T10:00:00.000Z' },
  { id: 'c', avgGrade: '80.5000000000000000', createdAt: '2026-08-07T10:00:00.000Z' }
]

/**
 * How every client ranks these rows — the contract's wording ("`grade-*` orders on the
 * aggregated `overallGrade` and breaks a tie with the newer interview first"), which is
 * also exactly what `COMPARE` in web/src/services/report-history.service.ts does and what
 * the store did client-side before this plan moved ordering to the server.
 */
function clientOrder(sort: 'grade-desc' | 'grade-asc'): string[] {
  const direction = sort === 'grade-desc' ? -1 : 1
  return [...SEEDS]
    .sort((x, y) => {
      const gradeDiff = (Math.round(Number(x.avgGrade)) - Math.round(Number(y.avgGrade))) * direction
      // Ties break newest-first in BOTH directions — the tie-break is not itself flipped.
      return gradeDiff || y.createdAt.localeCompare(x.createdAt)
    })
    .map(seed => seed.id)
}

function summaryRow(seed: Seed) {
  return {
    id: seed.id,
    job_title: 'backend',
    level: 'senior',
    type: 'technical',
    job_description: null,
    question_count: 5,
    model: null,
    created_at: new Date(seed.createdAt),
    avg_grade: seed.avgGrade
  }
}

/**
 * A Postgres stand-in that obeys the statement it is handed rather than a copy of the
 * repository's intent. It ranks on whatever expression the `order by` names — the rounded
 * average or the raw one — so the assertion below measures the SQL, not this helper.
 */
function makeDb(): Queryable {
  const rank = (sql: string, seed: Seed): number => {
    const orderBy = sql.slice(sql.indexOf('order by'))
    const exact = Number(seed.avgGrade)
    // `round(avg(e.grade))` would collapse 80.5 and 81.0 to one key, exactly as every
    // client already does; a bare `avg(e.grade)` keeps them apart.
    return /round\s*\(\s*avg\s*\(\s*e\.grade\s*\)\s*\)/.test(orderBy) ? Math.round(exact) : exact
  }

  return {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes('count(distinct i.id)')) {
        return { rows: [{ count: String(SEEDS.length) }] }
      }

      const orderBy = sql.slice(sql.indexOf('order by'))
      const gradeDirection = /avg\s*\(\s*e\.grade\s*\)\s*\)?\s*desc/.test(orderBy) ? -1 : 1

      const ordered = [...SEEDS].sort((x, y) => {
        const gradeDiff = (rank(sql, x) - rank(sql, y)) * gradeDirection
        // The statement's own second key: `i.created_at desc`.
        return gradeDiff || y.createdAt.localeCompare(x.createdAt)
      })

      const limit = Number(params[params.length - 2])
      const offset = Number(params[params.length - 1])

      return { rows: ordered.slice(offset, offset + limit).map(summaryRow) }
    }
  } as unknown as Queryable
}

async function pageIds(query: ListInterviewQuery): Promise<string[]> {
  const repository = createInterviewRepository(makeDb())
  const { items } = await repository.listInterviews(ORG, query)
  return items.map(item => item.id)
}

describe('grade ordering ranks on the grade the client can actually see', () => {
  it('gives every one of these interviews the same displayed grade', async () => {
    const repository = createInterviewRepository(makeDb())
    const { items } = await repository.listInterviews(ORG, { sort: 'grade-desc', pageSize: 50 })

    // The premise: to any client these three rows are a three-way tie on grade, so the
    // newest-first tie-break is the only thing that may decide their order.
    expect(items.map(item => item.overallGrade)).toEqual([81, 81, 81])
  })

  it.each(['grade-desc', 'grade-asc'] as const)(
    'orders %s the same way every client does',
    async sort => {
      expect(await pageIds({ sort, pageSize: 50 })).toEqual(clientOrder(sort))
    }
  )

  /**
   * The risk in the form the plan describes it: page the same ordering one row at a time
   * and compare against the client's ordering page by page. A rank the client cannot
   * reproduce puts a different row in a slot, which is what a user sees as a row that
   * appears on two pages or on none while paging.
   */
  it.each(['grade-desc', 'grade-asc'] as const)(
    'puts the same row in every page slot as the client does, under %s',
    async sort => {
      const expected = clientOrder(sort)

      for (let page = 1; page <= expected.length; page++) {
        expect(await pageIds({ sort, page, pageSize: 1 }), `page ${page}`).toEqual([
          expected[page - 1]
        ])
      }
    }
  )
})
