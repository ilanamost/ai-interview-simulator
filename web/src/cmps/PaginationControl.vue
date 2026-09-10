<script setup lang="ts">
import { computed } from 'vue'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'

const props = defineProps<{ page: number; pageCount: number }>()

/**
 * Controlled rather than stateful: the page number lives in the store, which is what
 * actually decides which rows exist, so this component only ever asks for a move.
 */
const emit = defineEmits<{ 'update:page': [page: number] }>()

const isFirst = computed(() => props.page <= 1)
const isLast = computed(() => props.page >= props.pageCount)
</script>

<template>
  <nav class="pagination" aria-label="Pages">
    <button
      type="button"
      class="btn btn-secondary pagination-prev"
      :disabled="isFirst"
      @click="emit('update:page', page - 1)"
    >
      <ChevronLeft :size="16" aria-hidden="true" />
      Previous
    </button>

    <!-- Polite, not assertive: the count changes under the user, it does not interrupt. -->
    <span class="pagination-label" aria-live="polite">Page {{ page }} of {{ pageCount }}</span>

    <button
      type="button"
      class="btn btn-secondary pagination-next"
      :disabled="isLast"
      @click="emit('update:page', page + 1)"
    >
      Next
      <ChevronRight :size="16" aria-hidden="true" />
    </button>
  </nav>
</template>
