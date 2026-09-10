<script setup lang="ts">
import { onMounted, reactive, watch } from 'vue'
import { ChevronDown, ChevronRight, FilterX } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import {
  PAGE_SIZE_OPTIONS,
  REPORT_SORTS,
  useReportHistoryStore,
  type ReportHistorySort
} from '@/stores/report-history.store'
import GradeBadge from '@/cmps/GradeBadge.vue'
import PaginationControl from '@/cmps/PaginationControl.vue'
import type { ReportHistoryFilters } from '@/services/report-history.service'
import {
  EXPERIENCE_LEVELS,
  INTERVIEW_TYPES,
  JOB_TITLES,
  type ExperienceLevel,
  type InterviewType,
  type JobTitle
} from '@/types/interview'
import {
  EXPERIENCE_LEVEL_LABEL,
  INTERVIEW_TYPE_LABEL,
  JOB_TITLE_LABEL,
  REPORT_SORT_LABEL
} from '@/services/label.service'
import { REPORT_TOAST } from '@/services/toast-message.service'

const store = useReportHistoryStore()

/**
 * `''` is this form's "no filter", never a value that reaches the source: an empty
 * `jobTitle` on the API is a validation error, not "all job titles".
 */
const form = reactive({
  date: '',
  jobTitle: '' as JobTitle | '',
  level: '' as ExperienceLevel | '',
  type: '' as InterviewType | ''
})

function toFilters(): ReportHistoryFilters {
  return {
    ...(form.date ? { date: form.date } : {}),
    ...(form.jobTitle ? { jobTitle: form.jobTitle } : {}),
    ...(form.level ? { level: form.level } : {}),
    ...(form.type ? { type: form.type } : {})
  }
}

/**
 * Every read this screen triggers — filters, ordering, paging — is one server round trip
 * now, so they all surface a failure the same way. The store sets `error` and rethrows.
 */
async function run(read: Promise<void>) {
  try {
    await read
  } catch {
    toast.error(store.error ?? REPORT_TOAST.listFailed)
  }
}

function load() {
  return run(store.fetchList(toFilters()))
}

/** Filters only, as the label says: reordering rows is not a predicate that hides them. */
function onClearFilters() {
  form.date = ''
  form.jobTitle = ''
  form.level = ''
  form.type = ''
}

/**
 * Sort is read straight off the store and written back through its action, deliberately
 * outside the `form` object below: `watch(form, load)` would re-send the filters as a
 * fresh query, and the store's own `setSort` already re-reads page 1 of the new ordering.
 */
function onSortChange(event: Event) {
  return run(store.setSort((event.target as HTMLSelectElement).value as ReportHistorySort))
}

/** Also outside `form`, for the same reason as sort: it re-reads through the store's own action. */
function onPageSizeChange(event: Event) {
  return run(store.setPageSize(Number((event.target as HTMLSelectElement).value)))
}

function onPageChange(next: number) {
  return run(store.setPage(next))
}

/**
 * The UTC calendar day, matching what the `date` filter matches on — showing a local
 * day here would let a row read "13 Aug" yet only be findable by filtering for the 14th.
 */
function toDay(createdAt: string): string {
  return createdAt.slice(0, 10)
}

onMounted(load)
watch(form, load)
</script>

<template>
  <section class="stack-lg">
    <header class="stack">
      <h1>Reports history</h1>
      <p class="text-muted">
        Every interview you have finished, in whichever order you choose. Open one to read the
        full report or download it as a PDF.
      </p>
    </header>

    <form class="card card-in stack history-filters" @submit.prevent>
      <div class="field-grid">
        <div class="field">
          <label for="filter-date">Date</label>
          <input id="filter-date" v-model="form.date" type="date" class="control" />
        </div>

        <div class="field">
          <label for="filter-job-title">Job title</label>
          <div class="select-field">
            <select id="filter-job-title" v-model="form.jobTitle" class="control">
              <option value="">All job titles</option>
              <option v-for="title in JOB_TITLES" :key="title" :value="title">
                {{ JOB_TITLE_LABEL[title] }}
              </option>
            </select>
            <span class="select-arrow" aria-hidden="true"><ChevronDown :size="18" /></span>
          </div>
        </div>

        <div class="field">
          <label for="filter-level">Experience level</label>
          <div class="select-field">
            <select id="filter-level" v-model="form.level" class="control">
              <option value="">All levels</option>
              <option v-for="level in EXPERIENCE_LEVELS" :key="level" :value="level">
                {{ EXPERIENCE_LEVEL_LABEL[level] }}
              </option>
            </select>
            <span class="select-arrow" aria-hidden="true"><ChevronDown :size="18" /></span>
          </div>
        </div>

        <div class="field">
          <label for="filter-type">Interview type</label>
          <div class="select-field">
            <select id="filter-type" v-model="form.type" class="control">
              <option value="">All types</option>
              <option v-for="type in INTERVIEW_TYPES" :key="type" :value="type">
                {{ INTERVIEW_TYPE_LABEL[type] }}
              </option>
            </select>
            <span class="select-arrow" aria-hidden="true"><ChevronDown :size="18" /></span>
          </div>
        </div>

        <!-- Not a filter: it changes the ordering the server pages through, not a predicate. -->
        <div class="field">
          <label for="sort-by">Sort by</label>
          <div class="select-field">
            <select id="sort-by" :value="store.sort" class="control" @change="onSortChange">
              <option v-for="option in REPORT_SORTS" :key="option" :value="option">
                {{ REPORT_SORT_LABEL[option] }}
              </option>
            </select>
            <span class="select-arrow" aria-hidden="true"><ChevronDown :size="18" /></span>
          </div>
        </div>

        <!-- Not a filter either: it changes how many rows one page holds, not which rows match. -->
        <div class="field">
          <label for="page-size">Records per page</label>
          <div class="select-field">
            <select
              id="page-size"
              :value="store.pageSize"
              class="control"
              @change="onPageSizeChange"
            >
              <option v-for="option in PAGE_SIZE_OPTIONS" :key="option" :value="option">
                {{ option }} per page
              </option>
            </select>
            <span class="select-arrow" aria-hidden="true"><ChevronDown :size="18" /></span>
          </div>
        </div>
      </div>

      <button
        v-if="store.hasFilters"
        type="button"
        class="btn btn-secondary clear-filters"
        @click="onClearFilters"
      >
        <FilterX :size="16" aria-hidden="true" />
        Clear filters
      </button>
    </form>

    <p v-if="store.isBusy" class="text-muted">Loading your reports…</p>

    <div v-else-if="store.list.length" class="stack history-list">
      <RouterLink
        v-for="item in store.list"
        :key="item.id"
        :to="{ name: 'report-detail', params: { id: item.id } }"
        class="card history-row"
      >
        <span class="history-row-main">
          <time class="text-sm text-muted" :datetime="item.createdAt">
            {{ toDay(item.createdAt) }}
          </time>
          <span class="history-row-config">
            {{ JOB_TITLE_LABEL[item.config.jobTitle] }} ·
            {{ EXPERIENCE_LEVEL_LABEL[item.config.level] }} ·
            {{ INTERVIEW_TYPE_LABEL[item.config.type] }}
          </span>
        </span>

        <span class="history-row-end">
          <GradeBadge :grade="item.overallGrade" />
          <ChevronRight :size="18" aria-hidden="true" />
        </span>
      </RouterLink>
    </div>

    <div v-else class="empty-state stack">
      <p v-if="store.hasFilters">No interviews match these filters.</p>
      <template v-else>
        <p>You have not finished an interview yet.</p>
        <p><RouterLink :to="{ name: 'setup' }">Practice your first one</RouterLink></p>
      </template>
    </div>

    <!-- Hidden whenever everything matching already fits on one page. -->
    <PaginationControl
      v-if="store.pageCount > 1"
      :page="store.page"
      :page-count="store.pageCount"
      @update:page="onPageChange"
    />
  </section>
</template>
