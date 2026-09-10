<script setup lang="ts">
import type { Evaluation } from '@/types/interview'
import GradeBadge from './GradeBadge.vue'

defineProps<{ evaluation: Evaluation }>()
</script>

<template>
  <article class="card evaluation-card">
    <header class="row-between">
      <h3>Feedback</h3>
      <GradeBadge :grade="evaluation.grade" />
    </header>

    <p>{{ evaluation.summary }}</p>

    <div v-if="evaluation.strengths.length" class="feedback-group">
      <h4>What worked</h4>
      <ul>
        <li v-for="item in evaluation.strengths" :key="item">{{ item }}</li>
      </ul>
    </div>

    <div v-if="evaluation.improvements.length" class="feedback-group">
      <h4>What to improve</h4>
      <ul>
        <li v-for="item in evaluation.improvements" :key="item">{{ item }}</li>
      </ul>
    </div>
  </article>
</template>
