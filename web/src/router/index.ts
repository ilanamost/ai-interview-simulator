import { createRouter, createWebHistory, type Router, type RouterHistory } from 'vue-router'
import HomeView from '@/views/HomeView.vue'
import LoginView from '@/views/LoginView.vue'
import SetupView from '@/views/SetupView.vue'
import { useAuthStore } from '@/stores/auth.store'
import { useInterviewStore } from '@/stores/interview.store'

export const routes = [
  // The only public route: everything else is behind `requiresAuth`.
  { path: '/login', name: 'login', component: LoginView },
  { path: '/', name: 'home', component: HomeView, meta: { requiresAuth: true } },
  // Keep `name: 'setup'` — the guards below redirect by name, so relocating this
  // path from '/' to '/practice' leaves them untouched.
  { path: '/practice', name: 'setup', component: SetupView, meta: { requiresAuth: true } },
  {
    path: '/interview',
    name: 'interview',
    component: () => import('@/views/InterviewView.vue'),
    meta: { requiresAuth: true, requiresSession: true }
  },
  {
    path: '/report',
    name: 'report',
    component: () => import('@/views/ReportView.vue'),
    meta: { requiresAuth: true, requiresReport: true }
  },
  /*
   * Past reports are read straight from their own store, so neither route depends on
   * a live session or the live report — plain `requiresAuth`, like home and practice.
   * `meta` on the parent is merged into both children's `to.meta`, so the guard below
   * sees `requiresAuth` on each of them exactly as it would on a flat record.
   *
   * The parent carries no component of its own: it exists so the list and one report's
   * detail share a matched record, which is what makes vue-router mark the header's
   * "Reports" link active on a detail page too. Flat sibling routes would leave the nav
   * claiming you are nowhere while you read a report.
   */
  {
    path: '/reports',
    meta: { requiresAuth: true },
    children: [
      { path: '', name: 'reports', component: () => import('@/views/ReportsHistoryView.vue') },
      {
        path: ':id',
        name: 'report-detail',
        component: () => import('@/views/ReportHistoryDetailView.vue')
      }
    ]
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('@/views/UserSettingsView.vue'),
    meta: { requiresAuth: true }
  },
  { path: '/:pathMatch(.*)*', redirect: '/' }
]

/** Factory so tests can mount the same routes and guards over a memory history. */
export function createAppRouter(history: RouterHistory): Router {
  const router = createRouter({ history, routes })

  // Both stores are hydrated before the app mounts (see `main.ts`) — `fetchMe` for
  // auth, `rehydrate` for the session — so the first navigation already knows who
  // the visitor is and whether there is anything to resume.
  router.beforeEach(to => {
    const auth = useAuthStore()
    const interview = useInterviewStore()

    // Fail closed: an unknown visitor gets the login screen before any other check.
    if (to.meta.requiresAuth && !auth.isAuthenticated) return { name: 'login' }
    if (to.name === 'login' && auth.isAuthenticated) return { name: 'home' }

    if (to.meta.requiresSession && !interview.hasSession) return { name: 'setup' }
    if (to.meta.requiresReport && !interview.report) return { name: 'setup' }

    return true
  })

  return router
}

export default createAppRouter(createWebHistory(import.meta.env.BASE_URL))
