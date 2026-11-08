<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useLoaderStore } from '@/stores/loader.store'
import { LOADER_GRACE_MS } from '@/services/loader.service'

const loader = useLoaderStore()
const isVisible = ref(false)
let graceTimer: ReturnType<typeof setTimeout> | undefined

function clearGraceTimer() {
  clearTimeout(graceTimer)
  graceTimer = undefined
}

watch(
  () => loader.isLoading,
  isLoading => {
    clearGraceTimer()

    if (!isLoading) {
      isVisible.value = false
      return
    }

    graceTimer = setTimeout(() => {
      isVisible.value = true
    }, LOADER_GRACE_MS)
  },
  { immediate: true }
)

onBeforeUnmount(clearGraceTimer)
</script>

<template>
  <!--
    A full-screen overlay on purpose: it also blocks a second click on whatever
    started the call. Button spinners stay where they are — they say which action
    is pending; this says "the app is waiting on the server".
  -->
  <div v-if="isVisible" class="api-loader" role="status" aria-live="polite">
    <span class="spinner api-loader-spinner" aria-hidden="true"></span>
    <span class="api-loader-label">Loading…</span>
  </div>
</template>
