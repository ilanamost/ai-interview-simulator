import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './styles/main.scss'
import { useAuthStore } from './stores/auth.store'
import { useInterviewStore } from './stores/interview.store'

async function bootstrap() {
  const app = createApp(App)

  app.use(createPinia())

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

bootstrap()
