import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import ApiLoader from './cmps/ApiLoader.vue'
import router from './router'
import './styles/main.scss'
import { useAuthStore } from './stores/auth.store'
import { useInterviewStore } from './stores/interview.store'

async function bootstrapApp() {
  const pinia = createPinia()

  // The global API loader is its own tiny app on its own mount point, sharing this
  // pinia, rather than a child of App.vue: App only mounts once the boot-time calls
  // below have settled, and those are exactly the calls a cold start waits on. Mounted
  // first, it is already watching the loader store when `fetchMe()` goes out.
  createApp(ApiLoader).use(pinia).mount('#api-loader')

  const app = createApp(App)

  app.use(pinia)

  // Who is this? Resolved first, because the router's auth guard runs before every
  // other check and because a resumed session is only worth fetching for a signed-in
  // user. A signed-out visitor resolves to "not authenticated" rather than throwing.
  await useAuthStore().fetchMe()

  // Resume a persisted session before the router's guards evaluate the first
  // navigation, so a deep link or refresh into /interview or /report can land there.
  await useInterviewStore().rehydrate()

  app.use(router)
  app.mount('#app')
}

void bootstrapApp()
