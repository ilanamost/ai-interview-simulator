<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { RouterLink } from 'vue-router'
import {
  ClipboardList,
  FileDown,
  Gauge,
  History,
  MessageSquareText,
  Mic,
  Play,
  Target
} from 'lucide-vue-next'
import type { Component } from 'vue'
import AccordionSection from '@/cmps/AccordionSection.vue'
import { staggerStyle } from '@/services/animation.service'

type HomeStep = { title: string; text: string }
type HomeFeature = { icon: Component; title: string; text: string }

const STEPS: HomeStep[] = [
  {
    title: 'Set up the interview',
    text: 'Pick a job title, experience level and interview type, and how many questions you want. Paste a job description to get one question tailored to it.'
  },
  {
    title: 'Answer one question at a time',
    text: 'Questions arrive one by one, so you stay in the interview instead of scanning a list. Type your answer or dictate it.'
  },
  {
    title: 'Get graded immediately',
    text: 'Every answer comes back with a numeric grade, a short summary, what you did well and what to improve — and a follow-up question when an answer leaves a gap.'
  },
  {
    title: 'Review your report',
    text: 'Finish with an overall grade, the strengths that kept showing up, what to work on next, and a question-by-question breakdown you can download.'
  }
]

const FEATURES: HomeFeature[] = [
  {
    icon: Target,
    title: 'Role-specific questions',
    text: 'The question bank follows your job title, level and interview type — frontend, backend, fullstack, devops or data.'
  },
  {
    icon: MessageSquareText,
    title: 'Immediate feedback',
    text: 'No waiting for a reviewer. Each answer is evaluated the moment you submit it.'
  },
  {
    icon: Gauge,
    title: 'Quantified grading',
    text: 'Every answer and the interview as a whole get a grade out of 100, so progress across runs is comparable.'
  },
  {
    icon: ClipboardList,
    title: 'Adaptive follow-ups',
    text: 'A thin answer earns a follow-up that drills into the same topic, the way a real interviewer would push.'
  },
  {
    icon: Mic,
    title: 'Answer by voice',
    text: 'Dictate your answer instead of typing it, and practise saying it out loud before the real thing.'
  },
  {
    icon: History,
    title: 'Resumable sessions',
    text: 'Refresh or close the tab mid-question and you come back to exactly where you left off.'
  },
  {
    icon: FileDown,
    title: 'Downloadable report',
    text: 'Take the full report away as a PDF to review later or work through with someone else.'
  }
]

const howItWorks = ref<InstanceType<typeof AccordionSection> | null>(null)

/**
 * Every section starts collapsed, so the browser's native hash jump would drop the
 * reader on a heading with nothing underneath it. Open the section first, then take
 * them there.
 */
async function showHowItWorks() {
  howItWorks.value?.open()
  await nextTick()
  document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })
}
</script>

<template>
  <div class="home stack-lg">
    <section class="home-hero card card-in stack" aria-labelledby="home-hero-title">
      <p class="eyebrow">AI Interview Simulator</p>
      <h1 id="home-hero-title">Practice technical interviews, get graded in seconds</h1>
      <p class="lead">
        A low-stakes place to rehearse the interview you are actually preparing for. Choose the
        role, level and interview type, answer AI-generated questions one at a time, and walk away
        with actionable feedback and a grade.
      </p>
      <div class="row">
        <RouterLink to="/practice" class="btn">
          <Play :size="16" aria-hidden="true" />
          Start practicing
        </RouterLink>
        <a href="#how-it-works" class="text-sm text-muted" @click.prevent="showHowItWorks">
          See how it works
        </a>
      </div>
    </section>

    <AccordionSection title="What it does">
      <p class="text-muted">
        Built for candidates from entry level to senior, and for anyone moving into a new role who
        wants to find their gaps before an interviewer does. Mock interviews with peers need
        scheduling and give vague feedback. Coaching costs money. This gives you detailed,
        repeatable, quantified feedback with no sign-up and no cost.
      </p>
    </AccordionSection>

    <AccordionSection id="how-it-works" ref="howItWorks" title="How it works">
      <ol class="home-steps">
        <li
          v-for="(step, index) in STEPS"
          :key="step.title"
          class="card card-in home-step"
          :style="staggerStyle(index)"
        >
          <span class="step-number" aria-hidden="true">{{ index + 1 }}</span>
          <div class="item-text">
            <h3>{{ step.title }}</h3>
            <p class="text-muted">{{ step.text }}</p>
          </div>
        </li>
      </ol>
    </AccordionSection>

    <AccordionSection title="Key features">
      <ul class="home-features">
        <li
          v-for="(feature, index) in FEATURES"
          :key="feature.title"
          class="card card-in home-feature"
          :style="staggerStyle(index)"
        >
          <component :is="feature.icon" class="feature-icon" :size="20" aria-hidden="true" />
          <div class="item-text">
            <h3>{{ feature.title }}</h3>
            <p class="text-muted">{{ feature.text }}</p>
          </div>
        </li>
      </ul>
    </AccordionSection>
  </div>
</template>
