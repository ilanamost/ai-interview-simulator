import { describe, expect, it, vi } from 'vitest'
import { createInterviewRepository } from './interview.repository.js'
import { buildReport } from '../services/interview.service.js'
import type { Queryable } from '../db/types.js'
import type { Evaluation, InterviewConfig, InterviewSession } from '../types/interview.js'

const ORG = 'default'

function makeConfig(overrides: Partial<InterviewConfig> = {}): InterviewConfig {
  return { jobTitle: 'backend', level: 'senior', type: 'technical', questionCount: 5, ...overrides }
}

function makeDb(
  queryImpl: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>
): Queryable {
  return { query: vi.fn(queryImpl) } as unknown as Queryable
}

describe('interview.repository', () => {
  describe('createInterview', () => {
    it('inserts the config and scopes the row to the given org', async () => {
      const db = makeDb(async () => ({
        rows: [
          {
            id: 'i1',
            job_title: 'backend',
            level: 'senior',
            type: 'technical',
            job_description: null,
            question_count: 5,
            model: null,
            created_at: new Date('2026-07-18T10:00:00.000Z')
          }
        ]
      }))
      const repository = createInterviewRepository(db)

      const session = await repository.createInterview({ id: 'i1', org: ORG, config: makeConfig() })

      expect(session).toEqual({
        id: 'i1',
        config: makeConfig(),
        createdAt: '2026-07-18T10:00:00.000Z',
        asked: [],
        answers: [],
        evaluations: []
      })
      expect(db.query).toHaveBeenCalledWith(expect.stringContaining('insert into interview'), [
        'i1',
        ORG,
        'backend',
        'senior',
        'technical',
        null,
        5,
        null
      ])
    })

    it('persists the chosen model and reads it back on the session config', async () => {
      const db = makeDb(async () => ({
        rows: [
          {
            id: 'i1',
            job_title: 'backend',
            level: 'senior',
            type: 'technical',
            job_description: null,
            question_count: 5,
            model: 'claude-opus-5',
            created_at: new Date('2026-07-18T10:00:00.000Z')
          }
        ]
      }))
      const repository = createInterviewRepository(db)

      const session = await repository.createInterview({
        id: 'i1',
        org: ORG,
        config: makeConfig({ model: 'claude-opus-5' })
      })

      expect(session.config.model).toBe('claude-opus-5')
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('insert into interview'),
        expect.arrayContaining(['claude-opus-5'])
      )
    })
  })

  describe('getInterview', () => {
    it('returns null when no row matches the id and org', async () => {
      const db = makeDb(async () => ({ rows: [] }))
      const repository = createInterviewRepository(db)

      await expect(repository.getInterview('missing', ORG)).resolves.toBeNull()
    })

    it('scopes every child query (questions, answers, evaluations) by org', async () => {
      const calls: Array<{ sql: string; params: unknown[] }> = []
      const db = makeDb(async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params })
        if (sql.startsWith('select id, job_title')) {
          return {
            rows: [
              {
                id: 'i1',
                job_title: 'backend',
                level: 'senior',
                type: 'technical',
                job_description: null,
                question_count: 5,
                model: null,
                created_at: new Date('2026-07-18T10:00:00.000Z')
              }
            ]
          }
        }
        return { rows: [] }
      })
      const repository = createInterviewRepository(db)

      await repository.getInterview('i1', ORG)

      const childQueries = calls.filter(
        c =>
          c.sql.includes('from question') ||
          c.sql.includes('from answer') ||
          c.sql.includes('from evaluation')
      )
      expect(childQueries).toHaveLength(3)
      for (const call of childQueries) {
        expect(call.params).toEqual(['i1', ORG])
      }
    })

    it('reads a row written before the model column existed as "no model chosen"', async () => {
      const db = makeDb(async (sql: string) => {
        if (sql.startsWith('select id, job_title')) {
          return {
            rows: [
              {
                id: 'i1',
                job_title: 'backend',
                level: 'senior',
                type: 'technical',
                job_description: null,
                question_count: 5,
                model: null,
                created_at: new Date('2026-07-18T10:00:00.000Z')
              }
            ]
          }
        }
        return { rows: [] }
      })
      const repository = createInterviewRepository(db)

      const session = await repository.getInterview('i1', ORG)

      expect(session?.config.model).toBeUndefined()
    })
  })

  describe('listInterviews', () => {
    /**
     * Captures both queries listInterviews issues — the page and the count — so each
     * can be inspected on its own. `total` defaults to "everything the page returned",
     * which is what an unpaginated call would see.
     */
    function makeListDb(rows: Record<string, unknown>[] = [], total = rows.length) {
      const calls: Array<{ sql: string; params: unknown[] }> = []
      const db = makeDb(async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params })
        return sql.includes('count(distinct') ? { rows: [{ count: String(total) }] } : { rows }
      })
      const pageQuery = () => calls.filter(c => c.sql.includes('avg(e.grade) as avg_grade'))[0]
      const countQuery = () => calls.filter(c => c.sql.includes('count(distinct'))[0]
      return { db, calls, pageQuery, countQuery }
    }

    function summaryRow(overrides: Record<string, unknown> = {}) {
      return {
        id: 'i1',
        job_title: 'backend',
        level: 'senior',
        type: 'technical',
        job_description: null,
        question_count: 5,
        model: null,
        created_at: new Date('2026-07-18T10:00:00.000Z'),
        avg_grade: '80.0000000000000000',
        ...overrides
      }
    }

    it('maps a row to a summary: id, config, createdAt and the aggregated grade', async () => {
      const { db } = makeListDb([summaryRow()])
      const repository = createInterviewRepository(db)

      await expect(repository.listInterviews(ORG)).resolves.toEqual({
        items: [
          {
            id: 'i1',
            config: makeConfig(),
            createdAt: '2026-07-18T10:00:00.000Z',
            overallGrade: 80
          }
        ],
        total: 1
      })
    })

    it('returns newest first', async () => {
      const { db, pageQuery } = makeListDb()
      const repository = createInterviewRepository(db)

      await repository.listInterviews(ORG)

      expect(pageQuery().sql).toContain('order by i.created_at desc')
    })

    it('scopes to the given org and never returns another org rows', async () => {
      // The mock answers only for org-a, so a query that dropped the org scope
      // (or bound the wrong value) comes back empty instead of leaking rows.
      const db = makeDb(async (sql: string, params: unknown[] = []) => {
        if (params[0] !== 'org-a') return { rows: [] }
        if (sql.includes('count(distinct')) return { rows: [{ count: '1' }] }
        return { rows: [summaryRow()] }
      })
      const repository = createInterviewRepository(db)

      await expect(repository.listInterviews('org-a')).resolves.toEqual({
        items: [expect.objectContaining({ id: 'i1' })],
        total: 1
      })
      await expect(repository.listInterviews('org-b')).resolves.toEqual({ items: [], total: 0 })
    })

    it('always constrains org and excludes soft-deleted interviews', async () => {
      const { db, pageQuery } = makeListDb()
      const repository = createInterviewRepository(db)

      await repository.listInterviews(ORG)

      expect(pageQuery().sql).toContain('i.org = $1')
      expect(pageQuery().sql).toContain('i.deleted_at is null')
      // The org is still the first bound value; only the page window follows it.
      expect(pageQuery().params[0]).toBe(ORG)
    })

    it('excludes an interview with zero evaluations by joining evaluation inline', async () => {
      // "Has a report" is defined as "has at least one evaluation" (the same rule
      // getReport enforces with NO_EVALUATION). An INNER join is what enforces it —
      // a left join would surface never-answered interviews with a null grade.
      const { db, pageQuery } = makeListDb()
      const repository = createInterviewRepository(db)

      await repository.listInterviews(ORG)

      expect(pageQuery().sql).toContain('join evaluation e on e.interview_id = i.id')
      expect(pageQuery().sql).not.toContain('left join')
    })

    it('applies no extra condition when no filter is given', async () => {
      const { db, pageQuery, countQuery } = makeListDb()
      const repository = createInterviewRepository(db)

      await repository.listInterviews(ORG, {})

      expect(countQuery().params).toEqual([ORG])
      expect(pageQuery().sql).not.toContain('i.job_title =')
      expect(pageQuery().sql).not.toContain('created_at at time zone')
    })

    it('filters by calendar day in UTC, bound as a parameter', async () => {
      const { db, pageQuery, countQuery } = makeListDb()
      const repository = createInterviewRepository(db)

      await repository.listInterviews(ORG, { date: '2026-08-14' })

      // Pinned to UTC so the result never depends on the database session TimeZone.
      expect(pageQuery().sql).toContain("(i.created_at at time zone 'UTC')::date = $2::date")
      expect(countQuery().params).toEqual([ORG, '2026-08-14'])
    })

    it.each([
      ['jobTitle', 'i.job_title = $2', 'backend'],
      ['level', 'i.level = $2', 'senior'],
      ['type', 'i.type = $2', 'behavioral']
    ])('filters by %s alone', async (key, predicate, value) => {
      const { db, pageQuery, countQuery } = makeListDb()
      const repository = createInterviewRepository(db)

      await repository.listInterviews(ORG, { [key]: value })

      expect(pageQuery().sql).toContain(predicate)
      expect(countQuery().params).toEqual([ORG, value])
    })

    it('combines every filter with AND, each as its own bound parameter', async () => {
      const { db, pageQuery, countQuery } = makeListDb()
      const repository = createInterviewRepository(db)

      await repository.listInterviews(ORG, {
        date: '2026-08-14',
        jobTitle: 'frontend',
        level: 'mid',
        type: 'system-design'
      })

      expect(pageQuery().sql).toContain("(i.created_at at time zone 'UTC')::date = $2::date")
      expect(pageQuery().sql).toContain('i.job_title = $3')
      expect(pageQuery().sql).toContain('i.level = $4')
      expect(pageQuery().sql).toContain('i.type = $5')
      expect(countQuery().params).toEqual([ORG, '2026-08-14', 'frontend', 'mid', 'system-design'])
    })

    it('never concatenates a filter value into the SQL text', async () => {
      const { db, pageQuery } = makeListDb()
      const repository = createInterviewRepository(db)

      await repository.listInterviews(ORG, { jobTitle: "backend'; drop table interview--" as never })

      expect(pageQuery().sql).not.toContain('drop table')
      expect(pageQuery().params).toContain("backend'; drop table interview--")
    })

    describe('paging', () => {
      it('asks for the first DEFAULT_PAGE_SIZE rows when neither page nor pageSize is given', async () => {
        const { db, pageQuery } = makeListDb()
        const repository = createInterviewRepository(db)

        await repository.listInterviews(ORG)

        expect(pageQuery().sql).toContain('limit $2 offset $3')
        expect(pageQuery().params).toEqual([ORG, 10, 0])
      })

      it.each([
        [1, 10, 10, 0],
        [2, 10, 10, 10],
        [3, 5, 5, 10],
        [7, 1, 1, 6],
        [1, 50, 50, 0]
      ])(
        'page %i at pageSize %i binds limit %i offset %i',
        async (page, pageSize, limit, offset) => {
          const { db, pageQuery } = makeListDb()
          const repository = createInterviewRepository(db)

          await repository.listInterviews(ORG, { page, pageSize })

          expect(pageQuery().params).toEqual([ORG, limit, offset])
        }
      )

      it('binds the window after every filter parameter, never before one', async () => {
        // A window bound ahead of the filters would shift every placeholder and
        // silently filter on the page size instead.
        const { db, pageQuery } = makeListDb()
        const repository = createInterviewRepository(db)

        await repository.listInterviews(ORG, { jobTitle: 'backend', page: 2, pageSize: 10 })

        expect(pageQuery().sql).toContain('i.job_title = $2')
        expect(pageQuery().sql).toContain('limit $3 offset $4')
        expect(pageQuery().params).toEqual([ORG, 'backend', 10, 10])
      })

      it('cuts the page only after grouping and ordering the whole set', async () => {
        const { db, pageQuery } = makeListDb()
        const repository = createInterviewRepository(db)

        await repository.listInterviews(ORG, { sort: 'grade-desc' })

        const { sql } = pageQuery()
        expect(sql.indexOf('group by i.id')).toBeLessThan(sql.indexOf('order by'))
        expect(sql.indexOf('order by')).toBeLessThan(sql.indexOf('limit'))
      })

      it('returns an empty page with the true total when asked past the last page', async () => {
        // Not an error: the client needs `total` to correct itself back into range.
        const { db } = makeListDb([], 42)
        const repository = createInterviewRepository(db)

        await expect(repository.listInterviews(ORG, { page: 99 })).resolves.toEqual({
          items: [],
          total: 42
        })
      })
    })

    describe('ordering', () => {
      it.each([
        ['date-desc', 'order by i.created_at desc'],
        ['date-asc', 'order by i.created_at asc'],
        ['grade-desc', 'order by round(avg(e.grade)) desc, i.created_at desc'],
        ['grade-asc', 'order by round(avg(e.grade)) asc, i.created_at desc']
      ])('orders by %s as `%s`', async (sort, orderBy) => {
        const { db, pageQuery } = makeListDb()
        const repository = createInterviewRepository(db)

        await repository.listInterviews(ORG, { sort: sort as never })

        expect(pageQuery().sql).toContain(orderBy)
      })

      it('breaks a grade tie with the newer interview in BOTH directions', async () => {
        // Load-bearing: overallGrade is a small integer, so ties are common. Without a
        // total order the same row can land on two pages, or on none.
        for (const sort of ['grade-desc', 'grade-asc'] as const) {
          const { db, pageQuery } = makeListDb()

          await createInterviewRepository(db).listInterviews(ORG, { sort })

          expect(pageQuery().sql).toMatch(
            /order by round\(avg\(e\.grade\)\) (desc|asc), i\.created_at desc/
          )
        }
      })

      it('falls back to newest-first when no sort is given, exactly as before paging', async () => {
        const { db, pageQuery } = makeListDb()
        const repository = createInterviewRepository(db)

        await repository.listInterviews(ORG, { page: 2 })

        expect(pageQuery().sql).toContain('order by i.created_at desc')
        expect(pageQuery().sql).not.toContain('avg(e.grade) desc')
      })

      it('picks the order clause from a fixed map, never from the request text', async () => {
        const { db, pageQuery } = makeListDb()
        const repository = createInterviewRepository(db)

        await repository.listInterviews(ORG, { sort: 'i.created_at; drop table interview--' as never })

        expect(pageQuery().sql).not.toContain('drop table')
      })
    })

    describe('total', () => {
      it('counts the filtered set with the same where clause and parameters as the page', async () => {
        const { db, pageQuery, countQuery } = makeListDb()
        const repository = createInterviewRepository(db)

        await repository.listInterviews(ORG, { jobTitle: 'backend', level: 'senior', page: 3 })

        expect(countQuery().sql).toContain('i.job_title = $2')
        expect(countQuery().sql).toContain('i.level = $3')
        expect(countQuery().sql).toContain('i.org = $1')
        expect(countQuery().sql).toContain('i.deleted_at is null')
        // Same filters, same bindings — minus the page window, which must not narrow it.
        expect(countQuery().params).toEqual([ORG, 'backend', 'senior'])
        expect(pageQuery().params).toEqual([ORG, 'backend', 'senior', 10, 20])
      })

      it('is independent of limit and offset', async () => {
        const { db, countQuery } = makeListDb()
        const repository = createInterviewRepository(db)

        await repository.listInterviews(ORG, { page: 4, pageSize: 5 })

        expect(countQuery().sql).not.toContain('limit')
        expect(countQuery().sql).not.toContain('offset')
      })

      it('counts interviews, not evaluation rows, so the join cannot inflate it', async () => {
        // The join emits one row per evaluation; the page collapses them with
        // `group by`, so a plain count(*) would report several times the real total.
        const { db, countQuery } = makeListDb()
        const repository = createInterviewRepository(db)

        await repository.listInterviews(ORG)

        expect(countQuery().sql).toContain('count(distinct i.id)')
      })

      it('reports the filtered total even when it far exceeds the page', async () => {
        const { db } = makeListDb([summaryRow()], 137)
        const repository = createInterviewRepository(db)

        const result = await repository.listInterviews(ORG, { pageSize: 1 })

        expect(result.items).toHaveLength(1)
        expect(result.total).toBe(137)
      })

      it('reads the count as a number, not the string pg sends', async () => {
        const { db } = makeListDb([], 8)
        const repository = createInterviewRepository(db)

        const { total } = await repository.listInterviews(ORG)

        expect(total).toBe(8)
        expect(typeof total).toBe('number')
      })
    })

    describe('overall grade', () => {
      function makeEvaluation(questionId: string, grade: number): Evaluation {
        return {
          questionId,
          grade,
          summary: 's',
          strengths: [],
          improvements: [],
          needsFollowUp: false
        }
      }

      /** A session whose evaluations are exactly the grades the SQL aggregate saw. */
      function sessionFor(grades: number[]): InterviewSession {
        return {
          id: 'i1',
          config: makeConfig(),
          createdAt: '2026-07-18T10:00:00.000Z',
          asked: [],
          answers: [],
          evaluations: grades.map((grade, i) => makeEvaluation(`q${i}`, grade))
        }
      }

      // Every case includes a follow-up's grade: buildReport averages base and
      // follow-up evaluations alike, so the list query must not filter either out.
      it.each([
        ['whole average', [80, 90, 70]],
        ['average ending in .5, which rounds up', [75, 80]],
        ['a single evaluation', [63]],
        ['grades that repeat', [42, 42, 43]],
        ['a long tail of follow-ups', [100, 0, 50, 51, 49, 77]]
      ])('matches buildReport for %s', async (_label, grades) => {
        // Stand in for Postgres avg(): the exact mean, rendered as numeric does.
        const avg = grades.reduce((sum, g) => sum + g, 0) / grades.length
        const { db } = makeListDb([summaryRow({ avg_grade: avg.toFixed(16) })])
        const repository = createInterviewRepository(db)

        const { items } = await repository.listInterviews(ORG)

        expect(items[0].overallGrade).toBe(buildReport(sessionFor(grades)).overallGrade)
      })
    })
  })

  describe('addQuestion', () => {
    it('serializes keywords as JSON and maps the returned row back to a Question', async () => {
      const db = makeDb(async () => ({
        rows: [
          {
            id: 'q1',
            text: 'Explain X',
            topic: 'Rendering',
            is_follow_up: false,
            parent_id: null,
            keywords: ['a', 'b']
          }
        ]
      }))
      const repository = createInterviewRepository(db)

      const question = await repository.addQuestion({
        id: 'q1',
        interviewId: 'i1',
        org: ORG,
        position: 0,
        question: { text: 'Explain X', topic: 'Rendering', isFollowUp: false, keywords: ['a', 'b'] }
      })

      expect(question).toEqual({
        id: 'q1',
        text: 'Explain X',
        topic: 'Rendering',
        isFollowUp: false,
        parentId: undefined,
        keywords: ['a', 'b']
      })
    })
  })

  describe('countAskedBaseQuestions', () => {
    it('parses the count as a number', async () => {
      const db = makeDb(async () => ({ rows: [{ count: '3' }] }))
      const repository = createInterviewRepository(db)

      await expect(repository.countAskedBaseQuestions('i1', ORG)).resolves.toBe(3)
    })
  })
})
