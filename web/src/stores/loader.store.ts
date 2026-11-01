import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

/**
 * How many API calls are in flight right now. A counter, not a boolean: two calls
 * that overlap share one loader, and it hides only when the last of them settles.
 * Fed by `trackRequest` in `services/loader.service.ts`, read by `ApiLoader.vue`.
 */
export const useLoaderStore = defineStore('loader', () => {
  const pending = ref(0)

  const isLoading = computed(() => pending.value > 0)

  function start() {
    pending.value++
  }

  /** Clamped at 0, so a stray extra `stop()` can never push the counter negative and swallow the next call. */
  function stop() {
    pending.value = Math.max(0, pending.value - 1)
  }

  return { pending, isLoading, start, stop }
})
