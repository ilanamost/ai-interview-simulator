import { createApp } from 'vue'
import StartupLoader from '@/cmps/StartupLoader.vue'

export async function withStartupLoader(initialize: () => Promise<void>): Promise<void> {
  const target = document.getElementById('startup-loader')
  if (!target) throw new Error('Startup loader mount point was not found')

  const loader = createApp(StartupLoader)
  loader.mount(target)

  try {
    await initialize()
  } finally {
    loader.unmount()
  }
}
