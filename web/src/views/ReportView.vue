<script setup lang="ts">
import { useRouter } from 'vue-router'
import { Download, RotateCcw } from 'lucide-vue-next'
import { useInterviewStore } from '@/stores/interview.store'
import ReportCard from '@/cmps/ReportCard.vue'
import { downloadReportPdf } from '@/services/report-pdf.service'

const router = useRouter()
const store = useInterviewStore()

function onRestart() {
  store.reset()
  router.push({ name: 'setup' })
}

function onDownloadPdf() {
  if (!store.session || !store.report) return
  downloadReportPdf(store.session, store.report)
}
</script>

<template>
  <section v-if="store.report && store.session" class="stack-lg">
    <ReportCard :session="store.session" :report="store.report" />

    <button type="button" class="btn btn-secondary btn-block" @click="onDownloadPdf">
      <Download :size="16" aria-hidden="true" />
      Download PDF
    </button>

    <button type="button" class="btn btn-secondary btn-block" @click="onRestart">
      <RotateCcw :size="16" aria-hidden="true" />
      Run another interview
    </button>
  </section>

  <section v-else class="empty-state stack">
    <p>There is no report to show yet.</p>
    <p><RouterLink :to="{ name: 'setup' }">Start an interview</RouterLink></p>
  </section>
</template>
