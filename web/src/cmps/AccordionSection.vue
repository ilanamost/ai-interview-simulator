<script setup lang="ts">
import { ref, useId } from 'vue'
import { ChevronDown } from 'lucide-vue-next'

const props = withDefaults(defineProps<{ title: string; defaultOpen?: boolean }>(), {
  defaultOpen: false
})

/**
 * A native <details>/<summary> would give the keyboard and screen-reader semantics
 * for free, but it also insists on owning its open state, and the home page has to
 * open a section from the outside (the hero's "See how it works" link). The
 * button + aria-expanded pattern makes that state ours without losing anything: a
 * <button> is already activated by Enter and Space, and aria-expanded/aria-controls
 * announce the disclosure the same way.
 */
const isOpen = ref(props.defaultOpen)

const triggerId = useId()
const panelId = useId()

function open() {
  isOpen.value = true
}

function close() {
  isOpen.value = false
}

function toggle() {
  isOpen.value = !isOpen.value
}

defineExpose({ isOpen, open, close, toggle })
</script>

<template>
  <section class="accordion" :class="{ 'is-open': isOpen }">
    <h2 class="accordion-heading">
      <button
        :id="triggerId"
        type="button"
        class="accordion-trigger"
        :aria-expanded="isOpen"
        :aria-controls="panelId"
        @click="toggle"
      >
        <span class="accordion-title">{{ title }}</span>
        <ChevronDown class="accordion-chevron" :size="20" aria-hidden="true" />
      </button>
    </h2>

    <div
      v-show="isOpen"
      :id="panelId"
      class="accordion-panel"
      role="region"
      :aria-labelledby="triggerId"
    >
      <slot />
    </div>
  </section>
</template>
