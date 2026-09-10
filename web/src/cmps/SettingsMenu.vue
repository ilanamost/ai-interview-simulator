<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { LogOut, Settings, UserCog } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { useAuthStore } from '@/stores/auth.store'
import { AUTH_TOAST } from '@/services/toast-message.service'

const router = useRouter()
const auth = useAuthStore()

const open = ref(false)
const root = ref<HTMLElement | null>(null)

function close() {
  open.value = false
}

function toggle() {
  open.value = !open.value
}

/** A click anywhere else, or Escape, dismisses the menu the way a menu should. */
function onDocumentPointerDown(event: MouseEvent) {
  if (!root.value?.contains(event.target as Node)) close()
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') close()
}

// Listeners only exist while the menu is open, so a closed header costs nothing.
watch(open, isOpen => {
  if (isOpen) {
    document.addEventListener('pointerdown', onDocumentPointerDown)
    document.addEventListener('keydown', onDocumentKeydown)
    return
  }

  document.removeEventListener('pointerdown', onDocumentPointerDown)
  document.removeEventListener('keydown', onDocumentKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  document.removeEventListener('keydown', onDocumentKeydown)
})

async function goToSettings() {
  close()
  await router.push({ name: 'settings' })
}

async function onLogout() {
  close()

  // Success stays silent — landing on the login screen is the confirmation. A failure
  // is worth saying out loud: the session is gone here but may still live on the server.
  const ok = await auth.logout()
  if (!ok) {
    toast.error(auth.error?.trim() || AUTH_TOAST.logoutFailed)
  }

  // The guard would bounce any protected route anyway; go there directly so the
  // user sees the login screen rather than a flash of a page they no longer own.
  await router.push({ name: 'login' })
}
</script>

<template>
  <div ref="root" class="settings-menu">
    <button
      type="button"
      class="btn btn-ghost menu-trigger"
      aria-label="Settings"
      title="Settings"
      :aria-expanded="open"
      aria-haspopup="menu"
      @click="toggle"
    >
      <Settings :size="18" aria-hidden="true" />
    </button>

    <div v-if="open" class="menu-panel" role="menu">
      <button type="button" class="menu-item" role="menuitem" @click="goToSettings">
        <UserCog :size="16" aria-hidden="true" />
        User settings
      </button>

      <button type="button" class="menu-item" role="menuitem" @click="onLogout">
        <LogOut :size="16" aria-hidden="true" />
        Logout
      </button>
    </div>
  </div>
</template>
