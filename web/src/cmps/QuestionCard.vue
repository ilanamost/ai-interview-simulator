<script setup lang="ts">
import { CornerDownRight } from 'lucide-vue-next'
import type { Question } from '@/types/interview'

defineProps<{ question: Question }>()
</script>

<template>
  <article class="card question-card">
    <p class="topic">{{ question.topic }}</p>
    <h2 class="question-text">{{ question.text }}</h2>
    <p v-if="question.isFollowUp" class="follow-up-flag">
      <CornerDownRight :size="16" aria-hidden="true" />
      Follow-up on your previous answer
    </p>
  </article>
</template>
