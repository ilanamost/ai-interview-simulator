<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronDown, Play } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { useInterviewStore } from '@/stores/interview.store'
import {
  DEFAULT_LLM_MODEL,
  EXPERIENCE_LEVELS,
  INTERVIEW_TYPES,
  JOB_TITLES,
  LLM_MODELS,
  type InterviewConfig
} from '@/types/interview'
import {
  EXPERIENCE_LEVEL_LABEL,
  INTERVIEW_TYPE_LABEL,
  JOB_TITLE_LABEL,
  LLM_MODEL_LABEL
} from '@/services/label.service'
import { INTERVIEW_TOAST } from '@/services/toast-message.service'

const router = useRouter()
const store = useInterviewStore()

const QUESTION_COUNTS = [3, 5, 7]

const config = reactive<InterviewConfig>({
  jobTitle: 'frontend',
  level: 'mid',
  type: 'technical',
  jobDescription: '',
  questionCount: 5,
  model: DEFAULT_LLM_MODEL
})

const starting = ref(false)

async function onStart() {
  starting.value = true

  try {
    await store.start({ ...config, jobDescription: config.jobDescription?.trim() || undefined })
    await router.push('/interview')
  } catch {
    toast.error(store.error ?? INTERVIEW_TOAST.startFailed)
  } finally {
    starting.value = false
  }
}
</script>

<template>
  <section class="stack-lg">
    <header class="stack">
      <h1>Practice your next interview</h1>
      <p class="text-muted">
        Pick a role and an interview type. You will be asked one question at a time, get feedback
        and a grade on every answer, and finish with a full report.
      </p>
    </header>

    <form class="card card-in stack-lg" @submit.prevent="onStart">
      <div class="field-grid">
        <div class="field">
          <label for="job-title">Job title</label>
          <div class="select-field">
            <select id="job-title" v-model="config.jobTitle" class="control">
              <option v-for="title in JOB_TITLES" :key="title" :value="title">
                {{ JOB_TITLE_LABEL[title] }}
              </option>
            </select>
            <span class="select-arrow" aria-hidden="true"><ChevronDown :size="18" /></span>
          </div>
        </div>

        <div class="field">
          <label for="level">Experience level</label>
          <div class="select-field">
            <select id="level" v-model="config.level" class="control">
              <option v-for="level in EXPERIENCE_LEVELS" :key="level" :value="level">
                {{ EXPERIENCE_LEVEL_LABEL[level] }}
              </option>
            </select>
            <span class="select-arrow" aria-hidden="true"><ChevronDown :size="18" /></span>
          </div>
        </div>

        <div class="field">
          <label for="type">Interview type</label>
          <div class="select-field">
            <select id="type" v-model="config.type" class="control">
              <option v-for="type in INTERVIEW_TYPES" :key="type" :value="type">
                {{ INTERVIEW_TYPE_LABEL[type] }}
              </option>
            </select>
            <span class="select-arrow" aria-hidden="true"><ChevronDown :size="18" /></span>
          </div>
        </div>

        <div class="field">
          <label for="count">Number of questions</label>
          <div class="select-field">
            <select id="count" v-model.number="config.questionCount" class="control">
              <option v-for="count in QUESTION_COUNTS" :key="count" :value="count">
                {{ count }} questions
              </option>
            </select>
            <span class="select-arrow" aria-hidden="true"><ChevronDown :size="18" /></span>
          </div>
        </div>

        <div class="field">
          <label for="model">Model</label>
          <div class="select-field">
            <select id="model" v-model="config.model" class="control">
              <option v-for="model in LLM_MODELS" :key="model" :value="model">
                {{ LLM_MODEL_LABEL[model] }}
              </option>
            </select>
            <span class="select-arrow" aria-hidden="true"><ChevronDown :size="18" /></span>
          </div>
          <p class="hint">A stronger model asks and grades better, and costs more per interview.</p>
        </div>
      </div>

      <div class="field">
        <label for="jd">Job description <span class="text-muted">(optional)</span></label>
        <textarea
          id="jd"
          v-model="config.jobDescription"
          class="control"
          placeholder="Paste the posting to get one question tailored to it."
        />
        <p class="hint">
          Leave this empty for a general interview. Nothing you paste leaves your browser.
        </p>
      </div>

      <button type="submit" class="btn btn-block" :disabled="starting">
        <span v-if="starting" class="spinner" aria-hidden="true" />
        <Play v-else :size="16" aria-hidden="true" />
        {{ starting ? 'Preparing questions…' : 'Start interview' }}
      </button>
    </form>
  </section>
</template>
