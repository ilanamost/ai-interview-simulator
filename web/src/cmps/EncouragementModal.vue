<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue'
import { PartyPopper, Sparkles, Star, ThumbsUp, Trophy, X } from 'lucide-vue-next'
import { AUTO_DISMISS_MS, pickEncouragementMessage } from '@/services/gamification.service'

const props = withDefaults(
  defineProps<{
    open: boolean
    milestoneIndex: number
    /** True when the answer that earned this milestone was the interview's last. */
    isLastQuestion?: boolean
  }>(),
  { isLastQuestion: false }
)

const emit = defineEmits<{ close: [] }>()

/**
 * Matched 1:1 by count to `ENCOURAGEMENT_MESSAGES`, so a milestone's message and icon
 * stay paired. The icons live here rather than in `gamification.service.ts` to keep that
 * module pure — the same reason `toast-message.service.ts` holds copy and nothing else.
 */
const ICONS = [PartyPopper, Trophy, Sparkles, Star, ThumbsUp]

/** The view derives this from a counter, so clamp rather than trust it to be in range. */
const index = computed(() => Math.max(0, props.milestoneIndex))
const message = computed(() => pickEncouragementMessage(index.value))
const icon = computed(() => ICONS[index.value % ICONS.length])
const note = computed(() =>
  props.isLastQuestion
    ? 'That was the last question — your report is next.'
    : 'Keep going — the next question is waiting.'
)

let dismissTimer: ReturnType<typeof setTimeout> | null = null

function clearDismissTimer() {
  if (dismissTimer === null) return

  clearTimeout(dismissTimer)
  dismissTimer = null
}

/**
 * Every dismissal path lands here, and the timer is cleared first — otherwise closing
 * by hand would leave a pending timeout to emit a second `close` moments later.
 */
function close() {
  clearDismissTimer()
  emit('close')
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') close()
}

// Listener and timer only exist while the popup is up, following `SettingsMenu.vue`.
// Keyed on `milestoneIndex` too, not just `open` — a second milestone landing while the
// modal is still up changes the message but not `open`, and without this the new message
// would inherit whatever was left of the first one's dismiss timer.
watch(
  () => [props.open, props.milestoneIndex] as const,
  ([isOpen]) => {
    clearDismissTimer()

    if (!isOpen) {
      document.removeEventListener('keydown', onDocumentKeydown)
      return
    }

    document.addEventListener('keydown', onDocumentKeydown)
    dismissTimer = setTimeout(close, AUTO_DISMISS_MS)
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  clearDismissTimer()
  document.removeEventListener('keydown', onDocumentKeydown)
})
</script>

<template>
  <Transition name="encouragement">
    <div v-if="open" class="encouragement-backdrop" @click.self="close">
      <div class="encouragement-panel" role="status" aria-label="Milestone">
        <button
          type="button"
          class="btn btn-ghost encouragement-close"
          aria-label="Dismiss"
          @click="close"
        >
          <X :size="16" aria-hidden="true" />
        </button>

        <span class="encouragement-icon">
          <component :is="icon" :size="32" aria-hidden="true" />
        </span>

        <p class="encouragement-message" aria-live="polite">{{ message }}</p>
        <p class="encouragement-note">{{ note }}</p>
      </div>
    </div>
  </Transition>
</template>
