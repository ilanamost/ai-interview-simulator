<script setup lang="ts">
import { onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ArrowLeft, Download } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { useReportHistoryStore } from '@/stores/report-history.store'
import ReportCard from '@/cmps/ReportCard.vue'
import { downloadReportPdf } from '@/services/report-pdf.service'
import { REPORT_TOAST } from '@/services/toast-message.service'

const route = useRoute()
const store = useReportHistoryStore()

function onDownloadPdf() {
  if (!store.detail) return
  downloadReportPdf(store.detail.session, store.detail.report)
}

onMounted(async () => {
  const { id } = route.params

  try {
    await store.fetchDetail(String(id))
  } catch {
    toast.error(store.error ?? REPORT_TOAST.detailFailed)
  }
})
</script>

<template>
  <section v-if="store.detail" class="stack-lg">
    <p>
      <RouterLink :to="{ name: 'reports' }" class="back-link">
        <ArrowLeft :size="16" aria-hidden="true" />
        Back to history
      </RouterLink>
    </p>

    <!-- `animate` only here: the live report at /report stays unanimated on purpose. -->
    <ReportCard :session="store.detail.session" :report="store.detail.report" animate />

    <!-- No "Run another interview" here: this is a past report, not the live flow. -->
    <button type="button" class="btn btn-secondary btn-block" @click="onDownloadPdf">
      <Download :size="16" aria-hidden="true" />
      Download PDF
    </button>
  </section>

  <p v-else-if="store.isBusy" class="text-muted">Loading that report…</p>

  <section v-else class="empty-state stack">
    <p>That report could not be found. It may have been removed.</p>
    <p><RouterLink :to="{ name: 'reports' }">Back to history</RouterLink></p>
  </section>
</template>
