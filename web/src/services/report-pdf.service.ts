import { jsPDF } from 'jspdf'
import type { InterviewSession, Report } from '@/types/interview'
import {
  EXPERIENCE_LEVEL_LABEL,
  INTERVIEW_TYPE_LABEL,
  JOB_TITLE_LABEL
} from '@/services/label.service'

const PAGE_WIDTH = 210
const PAGE_HEIGHT = 297
const MARGIN = 20
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2

/** Text-layout mirror of ReportView.vue, built straight from the Report/session data. */
export function buildReportPdf(session: InterviewSession, report: Report): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  let y = MARGIN

  function ensureSpace(height: number) {
    if (y + height > PAGE_HEIGHT - MARGIN) {
      doc.addPage()
      y = MARGIN
    }
  }

  function addLines(text: string, fontSize: number, options: { bold?: boolean; gap?: number } = {}) {
    doc.setFont('helvetica', options.bold ? 'bold' : 'normal')
    doc.setFontSize(fontSize)

    const lines: string[] = doc.splitTextToSize(text, CONTENT_WIDTH)
    const lineHeight = fontSize * 0.42

    for (const line of lines) {
      ensureSpace(lineHeight)
      doc.text(line, MARGIN, y)
      y += lineHeight
    }

    y += options.gap ?? 2
  }

  function addBulletList(items: string[], fontSize = 11) {
    for (const item of items) {
      addLines(`• ${item}`, fontSize, { gap: 1 })
    }
  }

  const { config } = session
  addLines(
    `${JOB_TITLE_LABEL[config.jobTitle]} · ${EXPERIENCE_LEVEL_LABEL[config.level]} · ${INTERVIEW_TYPE_LABEL[config.type]}`,
    10,
    { gap: 4 }
  )
  addLines('Your report', 20, { bold: true, gap: 2 })
  addLines(`Overall grade: ${report.overallGrade} / 100`, 13, { bold: true, gap: 4 })
  addLines(report.headline, 12, { gap: 6 })

  if (report.strengths.length) {
    addLines('Recurring strengths', 13, { bold: true, gap: 2 })
    addBulletList(report.strengths)
    y += 4
  }

  if (report.improvements.length) {
    addLines('Focus on next', 13, { bold: true, gap: 2 })
    addBulletList(report.improvements)
    y += 4
  }

  addLines('Question by question', 15, { bold: true, gap: 4 })

  for (const entry of report.entries) {
    ensureSpace(20)
    addLines(entry.question.text, 12, { bold: true, gap: 1 })
    addLines(`Grade: ${entry.evaluation.grade} / 100`, 10, { gap: 2 })
    addLines(entry.answer.text, 10, { gap: 2 })
    addLines(entry.evaluation.summary, 10, { gap: 2 })

    if (entry.evaluation.improvements.length) {
      addLines('What to improve', 10, { bold: true, gap: 1 })
      addBulletList(entry.evaluation.improvements, 10)
    }

    y += 5
  }

  return doc
}

export function buildReportPdfFilename(session: InterviewSession, now = new Date()): string {
  const date = now.toISOString().slice(0, 10)
  return `interview-report-${session.config.jobTitle}-${session.config.level}-${date}.pdf`
}

export function downloadReportPdf(session: InterviewSession, report: Report): void {
  const doc = buildReportPdf(session, report)
  doc.save(buildReportPdfFilename(session))
}
