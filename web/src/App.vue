<script setup lang="ts">
import { computed, watch } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { MessagesSquare, Moon, Sun, User as UserIcon } from 'lucide-vue-next'
import { Toaster } from 'vue-sonner'
import SettingsMenu from '@/cmps/SettingsMenu.vue'
import { useAuthStore } from '@/stores/auth.store'
import { useThemeStore } from '@/stores/theme.store'

const auth = useAuthStore()
const theme = useThemeStore()
const route = useRoute()
const router = useRouter()

/** Names the action, not the current state, and flips with it — that is what a screen reader announces. */
const themeLabel = computed(() => (theme.isDark ? 'Switch to light mode' : 'Switch to dark mode'))

/**
 * A session can die while the user sits on a page, not only between navigations —
 * an access token expires mid-question — and the router guard only runs on a
 * navigation. Watching the flag here is what turns "the store noticed we are signed
 * out" into actually leaving the page they can no longer use.
 */
watch(
  () => auth.isAuthenticated,
  isAuthenticated => {
    if (!isAuthenticated && route.meta.requiresAuth) router.push({ name: 'login' })
  }
)
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <RouterLink to="/" class="brand">
        <MessagesSquare class="brand-icon" :size="22" aria-hidden="true" />
        AI Interview Simulator
      </RouterLink>

      <!--
        Only the top-level routes that make sense at any moment. `/interview` and
        `/report` are session-scoped and guarded, so a static link to either would just
        redirect away whenever there is nothing in flight. Every route here is behind
        `requiresAuth`, hence the same `isAuthenticated` gate the user block uses.

        `/settings` is deliberately absent: the header already reaches it twice below,
        through the avatar and the gear menu. A third link to the same page would be
        redundant navigation, not better navigation.

        The "you are here" indicator is vue-router's own `router-link-active`, styled
        in `styles/cmps/nav.scss` — no second source of truth for the current route.
      -->
      <nav v-if="auth.isAuthenticated" class="app-nav" aria-label="Main">
        <RouterLink :to="{ name: 'home' }" class="nav-link">Home</RouterLink>
        <RouterLink :to="{ name: 'setup' }" class="nav-link">Practice</RouterLink>
        <RouterLink :to="{ name: 'reports' }" class="nav-link">Reports</RouterLink>
      </nav>

      <!--
        Outside the `isAuthenticated` block on purpose: a color scheme is a device
        preference, not account data, so a signed-out visitor on /login gets it too.
      -->
      <button
        type="button"
        class="btn btn-ghost theme-toggle"
        :aria-label="themeLabel"
        :title="themeLabel"
        @click="theme.toggleTheme()"
      >
        <Sun v-if="theme.isDark" :size="18" aria-hidden="true" />
        <Moon v-else :size="18" aria-hidden="true" />
      </button>

      <!-- Signed out, the rest of the header is just the brand: nothing to configure yet. -->
      <div v-if="auth.isAuthenticated" class="header-user">
        <RouterLink :to="{ name: 'settings' }" class="avatar" :title="auth.user?.name">
          <img v-if="auth.user?.avatarUrl" :src="auth.user.avatarUrl" alt="Your profile picture" />
          <UserIcon v-else :size="18" aria-hidden="true" />
        </RouterLink>

        <SettingsMenu />
      </div>
    </header>

    <main class="app-main">
      <RouterView />
    </main>

    <Toaster position="bottom-right" rich-colors />
  </div>
</template>
