<script setup lang="ts">
import type { InterviewSession, Report } from '@/types/interview'
import GradeBadge from '@/cmps/GradeBadge.vue'
import {
  EXPERIENCE_LEVEL_LABEL,
  INTERVIEW_TYPE_LABEL,
  JOB_TITLE_LABEL
} from '@/services/label.service'
import { staggerStyle } from '@/services/animation.service'

/**
 * The read-only body of a report: header, recurring feedback, and every question.
 * Purely presentational and store-free, so the live report (`ReportView`) and a past
 * one (`ReportHistoryDetailView`) render identically from the same markup.
 *
 * Deliberately a fragment rather than a wrapping element: it drops straight into the
 * parent's `.stack-lg` the way the inline markup it replaced did.
 */
const props = withDefaults(
  defineProps<{
    session: InterviewSession
    report: Report
    /**
     * Opt-in entrance animation. Off by default because this component is shared: the
     * live report (`ReportView`) is already-shipped UI the plan deliberately left
     * unanimated, and only `ReportHistoryDetailView` passes it.
     */
    animate?: boolean
  }>(),
  { animate: false }
)

/** Stagger positions, in the order the cards read: header, feedback, then the entries. */
const HEADER_CARD = 0
const FEEDBACK_CARD = 1
const FIRST_ENTRY_CARD = 2

/**
 * The animation marking for the nth card in render order, or nothing at all when
 * `animate` is off — an absent class and an absent `style` attribute rather than empty
 * ones, so the live report's markup is byte-for-byte what it was.
 */
function cardIn(index: number) {
  if (!props.animate) return {}
  return { class: 'card-in', style: staggerStyle(index) }
}
</script>

<template>
  <header class="card stack" v-bind="cardIn(HEADER_CARD)">
    <p class="text-sm text-muted">
      {{ JOB_TITLE_LABEL[session.config.jobTitle] }} ·
      {{ EXPERIENCE_LEVEL_LABEL[session.config.level] }} ·
      {{ INTERVIEW_TYPE_LABEL[session.config.type] }}
    </p>
    <div class="row-between">
      <h1>Your report</h1>
      <GradeBadge :grade="report.overallGrade" large />
    </div>
    <p>{{ report.headline }}</p>
  </header>

  <div class="card stack" v-bind="cardIn(FEEDBACK_CARD)">
    <div v-if="report.strengths.length" class="feedback-group">
      <h3>Recurring strengths</h3>
      <ul>
        <li v-for="item in report.strengths" :key="item">{{ item }}</li>
      </ul>
    </div>

    <div v-if="report.improvements.length" class="feedback-group">
      <h3>Focus on next</h3>
      <ul>
        <li v-for="item in report.improvements" :key="item">{{ item }}</li>
      </ul>
    </div>
  </div>

  <h2>Question by question</h2>

  <article
    v-for="(entry, index) in report.entries"
    :key="entry.question.id"
    class="card stack report-entry"
    v-bind="cardIn(FIRST_ENTRY_CARD + index)"
  >
    <div class="row-between">
      <h3>{{ entry.question.text }}</h3>
      <GradeBadge :grade="entry.evaluation.grade" />
    </div>

    <p class="answer-text">{{ entry.answer.text }}</p>
    <p class="text-muted">{{ entry.evaluation.summary }}</p>

    <div v-if="entry.evaluation.improvements.length" class="feedback-group">
      <h4 class="text-sm text-muted">What to improve</h4>
      <ul>
        <li v-for="item in entry.evaluation.improvements" :key="item">{{ item }}</li>
      </ul>
    </div>
  </article>
</template>
