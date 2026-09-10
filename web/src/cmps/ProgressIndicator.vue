<script setup lang="ts">
defineProps<{
  answered: number
  total: number
  percent: number
}>()
</script>

<template>
  <div class="progress-indicator">
    <div class="meta">
      <span>Question {{ Math.min(answered + 1, total) }} of {{ total }}</span>
      <span>{{ percent }}% complete</span>
    </div>
    <div
      class="track"
      role="progressbar"
      :aria-valuenow="percent"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-label="Interview progress"
    >
      <div class="bar" :style="{ width: `${percent}%` }" />
    </div>
  </div>
</template>
