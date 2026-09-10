<script setup lang="ts">
import { computed } from 'vue'
import type { Grade } from '@/types/interview'

const props = withDefaults(
  defineProps<{
    grade: Grade
    label?: string
    large?: boolean
  }>(),
  { label: '', large: false }
)

const tone = computed(() => {
  if (props.grade >= 70) return 'is-good'
  if (props.grade >= 50) return 'is-fair'
  return 'is-weak'
})
</script>

<template>
  <span class="grade-badge" :class="[tone, { 'is-large': large }]">
    <span v-if="label" class="label">{{ label }}</span>
    <span>{{ grade }}</span>
    <span class="label">/ 100</span>
  </span>
</template>
