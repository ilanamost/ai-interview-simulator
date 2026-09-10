<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { Check, Mic, X } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { speechSource, type SpeechSession, type SpeechSource } from '@/services/speech.service'

const props = withDefaults(
  defineProps<{
    disabled?: boolean
    /** Swappable so tests can inject a stub instead of patching `window`. */
    source?: SpeechSource
  }>(),
  { disabled: false, source: () => speechSource }
)

const emit = defineEmits<{
  /** A settled chunk of speech, ready to go into the answer. */
  transcript: [text: string]
  listen: []
  /** Listening ended and the speech is the user's to keep. */
  commit: []
  /** Listening ended and everything heard this turn should be dropped. */
  cancel: []
}>()

const listening = ref(false)
const interim = ref('')

let session: SpeechSession | null = null
/** What the pending `onEnd` should mean; the browser cannot tell us on its own. */
let intent: 'commit' | 'cancel' = 'commit'

const supported = computed(() => props.source.isSupported())

function reset() {
  listening.value = false
  interim.value = ''
  session = null
}

function listen() {
  if (props.disabled || listening.value) return

  listening.value = true
  interim.value = ''
  intent = 'commit'
  emit('listen')

  session = props.source.start({
    onTranscript(text, isFinal) {
      if (!isFinal) {
        interim.value = text
        return
      }

      interim.value = ''
      emit('transcript', text)
    },
    onError(error) {
      // Keep whatever was already heard — an error mid-sentence should not
      // cost the user the sentences before it.
      intent = 'commit'
      toast.error(error.message)
    },
    onEnd() {
      const ended = intent
      reset()
      // Branched rather than `emit(ended)`: the emit overloads take one literal each.
      if (ended === 'cancel') emit('cancel')
      else emit('commit')
    }
  })
}

function commit() {
  intent = 'commit'
  session?.stop()
}

function cancel() {
  intent = 'cancel'
  session?.abort()
}

// An abandoned recognition keeps the browser's mic indicator lit.
onBeforeUnmount(() => session?.abort())
</script>

<template>
  <div v-if="supported" class="voice">
    <button
      v-if="!listening"
      type="button"
      class="btn btn-ghost voice-mic"
      :disabled="disabled"
      aria-label="Answer by voice"
      title="Answer by voice"
      @click="listen"
    >
      <Mic :size="16" aria-hidden="true" />
    </button>

    <div v-else class="voice-live" role="status" aria-live="polite">
      <span class="voice-wave" aria-hidden="true">
        <i /><i /><i /><i /><i />
      </span>
      <span class="voice-label">{{ interim || 'Listening…' }}</span>

      <button
        type="button"
        class="btn btn-ghost voice-action"
        aria-label="Discard what you said"
        title="Discard"
        @click="cancel"
      >
        <X :size="16" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="btn voice-action"
        aria-label="Use what you said"
        title="Use it"
        @click="commit"
      >
        <Check :size="16" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>
