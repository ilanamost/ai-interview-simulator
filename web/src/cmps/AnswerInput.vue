<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from 'vue'
import { Send } from 'lucide-vue-next'
import VoiceInput from './VoiceInput.vue'
import { appendTranscript } from '@/services/speech.service'

const props = defineProps<{
  questionId: string
  busy: boolean
}>()

const emit = defineEmits<{ submit: [text: string] }>()

const text = ref('')
const listening = ref(false)
/** What the box held before the mic was opened, so a cancel can undo the whole turn. */
const beforeListening = ref('')
const textarea = useTemplateRef<HTMLTextAreaElement>('textarea')

// Clear the draft when a new question arrives, so an answer never carries over.
watch(
  () => props.questionId,
  () => {
    text.value = ''
  }
)

const wordCount = computed(() => {
  const trimmed = text.value.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
})

// Submitting mid-sentence would send half a spoken answer, so the mic has to close first.
const canSubmit = computed(() => wordCount.value > 0 && !props.busy && !listening.value)

function onSubmit() {
  if (!canSubmit.value) return
  emit('submit', text.value)
}

function onListen() {
  beforeListening.value = text.value
  listening.value = true
}

function onTranscript(chunk: string) {
  text.value = appendTranscript(text.value, chunk)
}

function onCommit() {
  listening.value = false
  textarea.value?.focus()
}

function onCancel() {
  text.value = beforeListening.value
  listening.value = false
  textarea.value?.focus()
}
</script>

<template>
  <form class="card stack answer-input" @submit.prevent="onSubmit">
    <div class="field">
      <label :for="`answer-${questionId}`">Your answer</label>
      <textarea
        :id="`answer-${questionId}`"
        ref="textarea"
        v-model="text"
        class="control"
        :disabled="busy"
        placeholder="Answer as you would out loud. Ctrl+Enter submits."
        @keydown.ctrl.enter="onSubmit"
      />
      <div class="meta">
        <VoiceInput
          :key="questionId"
          :disabled="busy"
          @listen="onListen"
          @transcript="onTranscript"
          @commit="onCommit"
          @cancel="onCancel"
        />
        <span class="meta-counts">
          <span>{{ wordCount }} {{ wordCount === 1 ? 'word' : 'words' }}</span>
          <span>Ctrl + Enter to submit</span>
        </span>
      </div>
      <p v-if="listening" class="hint">
        Your speech is transcribed by your browser, which may send audio to its provider.
      </p>
    </div>

    <button type="submit" class="btn" :disabled="!canSubmit">
      <span v-if="busy" class="spinner" aria-hidden="true" />
      <Send v-else :size="16" aria-hidden="true" />
      {{ busy ? 'Evaluating…' : 'Submit answer' }}
    </button>
  </form>
</template>
