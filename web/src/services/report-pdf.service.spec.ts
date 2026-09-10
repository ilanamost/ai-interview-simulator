import { describe, expect, it } from 'vitest'
import { buildReportPdf, buildReportPdfFilename, downloadReportPdf } from './report-pdf.service'
import type { InterviewConfig, InterviewSession, Report, ReportEntry } from '@/types/interview'

function makeConfig(overrides: Partial<InterviewConfig> = {}): InterviewConfig {
  return { jobTitle: 'frontend', level: 'senior', type: 'technical', questionCount: 3, ...overrides }
}

function makeSession(overrides: Partial<InterviewSession> = {}): InterviewSession {
  return {
    id: 'session-1',
    config: makeConfig(),
    createdAt: '2026-07-26T10:00:00.000Z',
    asked: [],
    answers: [],
    evaluations: [],
    ...overrides
  }
}

function makeEntry(id: string): ReportEntry {
  return {
    question: { id, text: `Question text ${id}`, topic: 'Topic', isFollowUp: false, keywords: [] },
    answer: { questionId: id, text: `Answer for ${id}`, submittedAt: '2026-07-26T10:01:00.000Z' },
    evaluation: {
      questionId: id,
      grade: 80,
      summary: `Summary for ${id}`,
      strengths: [],
      improvements: [`Improve ${id}`],
      needsFollowUp: false
    }
  }
}

function makeReport(entries: ReportEntry[] = [makeEntry('q1')]): Report {
  return {
    overallGrade: 82,
    headline: 'Solid technical grasp with room to deepen tradeoff discussion.',
    strengths: ['Clear communication'],
    improvements: ['More concrete examples'],
    entries
  }
}

describe('buildReportPdf', () => {
  it('includes the headline, strengths, improvements and every question', () => {
    const session = makeSession()
    const report = makeReport([makeEntry('q1'), makeEntry('q2')])

    // Standard-14 fonts render uncompressed by default, so the raw PDF stream
    // contains the literal text -- simplest way to assert on real layout output.
    const raw = buildReportPdf(session, report).output()

    expect(raw).toContain('Solid technical grasp')
    expect(raw).toContain('Clear communication')
    expect(raw).toContain('More concrete examples')
    expect(raw).toContain('Question text q1')
    expect(raw).toContain('Question text q2')
    expect(raw).toContain('Improve q1')
  })

  it('spans multiple pages once entries overflow one page', () => {
    const session = makeSession()
    const manyEntries = Array.from({ length: 20 }, (_, i) => makeEntry(`q${i + 1}`))
    const report = makeReport(manyEntries)

    const doc = buildReportPdf(session, report)

    expect(doc.getNumberOfPages()).toBeGreaterThan(1)
  })
})

describe('buildReportPdfFilename', () => {
  it('builds a filename from job title, level and date', () => {
    const session = makeSession({ config: makeConfig({ jobTitle: 'backend', level: 'junior' }) })

    const filename = buildReportPdfFilename(session, new Date('2026-07-26T12:00:00.000Z'))

    expect(filename).toBe('interview-report-backend-junior-2026-07-26.pdf')
  })
})

describe('downloadReportPdf', () => {
  // jsPDF's save() delegates to a browser saveAs shim (createObjectURL + an
  // anchor click) that's a documented no-op under jsdom, so there's no DOM
  // side effect here to assert on -- this just proves build + save wiring
  // doesn't throw for a real report shape.
  it('builds and saves the report without throwing', () => {
    expect(() => downloadReportPdf(makeSession(), makeReport())).not.toThrow()
  })
})
