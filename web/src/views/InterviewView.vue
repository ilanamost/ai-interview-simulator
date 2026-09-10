<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowRight, FileText } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { useInterviewStore } from '@/stores/interview.store'
import QuestionCard from '@/cmps/QuestionCard.vue'
import AnswerInput from '@/cmps/AnswerInput.vue'
import EvaluationCard from '@/cmps/EvaluationCard.vue'
import ProgressIndicator from '@/cmps/ProgressIndicator.vue'
import EncouragementModal from '@/cmps/EncouragementModal.vue'
import { INTERVIEW_TYPE_LABEL, JOB_TITLE_LABEL } from '@/services/label.service'
import { INTERVIEW_TOAST } from '@/services/toast-message.service'

const router = useRouter()
const store = useInterviewStore()

const advancing = ref(false)
const showEncouragement = ref(false)

// The store finishes the interview on its own once questions run out.
watch(
  () => store.status,
  status => {
    if (status === 'complete') router.push('/report')
  }
)

/**
 * The store bumps a counter per milestone rather than flipping a flag, so two
 * celebrations in a row still register. `prev !== undefined` keeps the "only on a
 * change" intent explicit — a rehydrated nonzero starting value must not pop the modal
 * open the moment the screen mounts.
 */
watch(
  () => store.encouragementTrigger,
  (next, prev) => {
    if (prev !== undefined && next > prev) showEncouragement.value = true
  }
)

async function onSubmit(text: string) {
  try {
    await store.submitAnswer(text)
  } catch {
    toast.error(store.error ?? INTERVIEW_TOAST.evaluateFailed)
  }
}

async function onContinue() {
  advancing.value = true

  try {
    await store.continueInterview()
  } catch {
    toast.error(store.error ?? INTERVIEW_TOAST.nextQuestionFailed)
  } finally {
    advancing.value = false
  }
}

function onQuit() {
  store.reset()
  router.push({ name: 'setup' })
}
</script>

<template>
  <section v-if="store.session" class="stack-lg">
    <header class="stack">
      <div class="row-between">
        <h1 class="text-sm text-muted">
          {{ JOB_TITLE_LABEL[store.session.config.jobTitle] }} ·
          {{ INTERVIEW_TYPE_LABEL[store.session.config.type] }}
        </h1>
        <button type="button" class="btn btn-ghost text-sm" @click="onQuit">End interview</button>
      </div>
      <ProgressIndicator
        :answered="store.answeredCount"
        :total="store.totalCount"
        :percent="store.progress"
      />
    </header>

    <QuestionCard v-if="store.currentQuestion" :question="store.currentQuestion" />

    <AnswerInput
      v-if="store.currentQuestion && store.status !== 'reviewing'"
      :question-id="store.currentQuestion.id"
      :busy="store.status === 'evaluating'"
      @submit="onSubmit"
    />

    <template v-if="store.status === 'reviewing' && store.currentEvaluation">
      <EvaluationCard :evaluation="store.currentEvaluation" />

      <button type="button" class="btn btn-block" :disabled="advancing" @click="onContinue">
        <span v-if="advancing" class="spinner" aria-hidden="true" />
        <component
          :is="store.answeredCount >= store.totalCount ? FileText : ArrowRight"
          v-else
          :size="16"
          aria-hidden="true"
        />
        {{ store.answeredCount >= store.totalCount ? 'See your report' : 'Next question' }}
      </button>
    </template>

    <EncouragementModal
      :open="showEncouragement"
      :milestone-index="store.encouragementTrigger - 1"
      :is-last-question="store.answeredCount >= store.totalCount"
      @close="showEncouragement = false"
    />
  </section>

  <section v-else class="empty-state stack">
    <p>This interview is no longer active.</p>
    <p><RouterLink :to="{ name: 'setup' }">Start a new one</RouterLink></p>
  </section>
</template>
