<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Eye, EyeOff, ImageUp, Save, Trash2, User as UserIcon } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { useAuthStore } from '@/stores/auth.store'
import { AvatarError, readAvatarDataUrl } from '@/services/avatar.service'
import type { UpdateProfileInput } from '@/services/auth.service'
import { MIN_PASSWORD_LENGTH } from '@/types/user'
import { PROFILE_TOAST } from '@/services/toast-message.service'

const auth = useAuthStore()

const form = reactive({ name: '', email: '', currentPassword: '', password: '' })
const errors = reactive<Record<'name' | 'email' | 'currentPassword' | 'password', string>>({
  name: '',
  email: '',
  currentPassword: '',
  password: ''
})

/**
 * `undefined` means "avatar untouched", so an unrelated name change never sends an
 * avatar field. `null` is an explicit "remove it", which the API accepts as a clear.
 */
const avatarDraft = ref<string | null | undefined>(undefined)

/**
 * One ref per password field, never a shared one — revealing the current password
 * must not also expose the new one over the user's shoulder, and vice versa.
 */
const showCurrentPassword = ref(false)
const showNewPassword = ref(false)

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const avatarPreview = computed(() =>
  avatarDraft.value === undefined ? (auth.user?.avatarUrl ?? null) : avatarDraft.value
)

function resetFromUser() {
  form.name = auth.user?.name ?? ''
  form.email = auth.user?.email ?? ''
  form.currentPassword = ''
  form.password = ''
  avatarDraft.value = undefined
  clearErrors()
}

// Seeds the form on first render and re-seeds it after a save returns the saved user.
watch(() => auth.user, resetFromUser, { immediate: true })

function clearErrors() {
  errors.name = ''
  errors.email = ''
  errors.currentPassword = ''
  errors.password = ''
}

async function onPickAvatar(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  try {
    avatarDraft.value = await readAvatarDataUrl(file)
  } catch (err) {
    // Rejected before encoding, so no oversized request is ever sent.
    toast.error(err instanceof AvatarError ? err.message : PROFILE_TOAST.avatarUnusable)
  } finally {
    // Let the same file be re-picked after a rejection.
    input.value = ''
  }
}

function removeAvatar() {
  avatarDraft.value = null
}

function validate(): boolean {
  clearErrors()

  if (!form.name.trim()) errors.name = 'Enter your name.'

  const email = form.email.trim()
  if (!email) errors.email = 'Enter your email.'
  else if (!EMAIL_PATTERN.test(email)) errors.email = 'Enter a valid email address.'

  if (form.password) {
    if (form.password.length < MIN_PASSWORD_LENGTH) {
      errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`
    }
    // The API requires the current password alongside a new one, and rejects the
    // request without it — ask for it here rather than spending a round-trip.
    if (!form.currentPassword) errors.currentPassword = 'Enter your current password to change it.'
  }

  return !errors.name && !errors.email && !errors.currentPassword && !errors.password
}

/** Only what actually changed — the API takes a partial body and 400s on an empty one. */
function buildPatch(): UpdateProfileInput {
  const patch: UpdateProfileInput = {}
  const name = form.name.trim()
  const email = form.email.trim()

  if (name !== auth.user?.name) patch.name = name
  if (email !== auth.user?.email) patch.email = email
  if (avatarDraft.value !== undefined) patch.avatarUrl = avatarDraft.value
  if (form.password) {
    patch.password = form.password
    patch.currentPassword = form.currentPassword
  }

  return patch
}

async function onSubmit() {
  if (!validate()) return

  const patch = buildPatch()
  if (Object.keys(patch).length === 0) {
    toast.info(PROFILE_TOAST.nothingToSave)
    return
  }

  const ok = await auth.updateProfile(patch)

  // `auth.error` already reads as user-facing copy, including the wrong-current-password
  // case the store maps a 401 to here.
  if (!ok) {
    toast.error(auth.error?.trim() || PROFILE_TOAST.saveFailed)
    return
  }

  resetFromUser()
  toast.success(PROFILE_TOAST.saved)
}
</script>

<template>
  <section class="stack-lg">
    <header class="stack">
      <h1>User settings</h1>
      <p class="text-muted">Update your name, email, profile picture, or password.</p>
    </header>

    <form class="card stack-lg" novalidate @submit.prevent="onSubmit">
      <div class="avatar-field">
        <span class="avatar avatar-lg">
          <img v-if="avatarPreview" :src="avatarPreview" alt="Your profile picture" />
          <UserIcon v-else :size="28" aria-hidden="true" />
        </span>

        <div class="stack">
          <label for="avatar" class="btn btn-secondary avatar-pick">
            <ImageUp :size="16" aria-hidden="true" />
            Choose an image
          </label>
          <input
            id="avatar"
            class="avatar-input"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            @change="onPickAvatar"
          />
          <p class="hint">PNG, JPEG, WebP, or GIF, up to 2MB.</p>

          <button
            v-if="avatarPreview"
            type="button"
            class="btn btn-ghost avatar-remove"
            @click="removeAvatar"
          >
            <Trash2 :size="16" aria-hidden="true" />
            Remove picture
          </button>
        </div>
      </div>

      <div class="field">
        <label for="settings-name">Name</label>
        <input
          id="settings-name"
          v-model="form.name"
          class="control"
          type="text"
          autocomplete="name"
        />
        <p v-if="errors.name" class="field-error" role="alert">{{ errors.name }}</p>
      </div>

      <div class="field">
        <label for="settings-email">Email</label>
        <input
          id="settings-email"
          v-model="form.email"
          class="control"
          type="email"
          autocomplete="email"
        />
        <p v-if="errors.email" class="field-error" role="alert">{{ errors.email }}</p>
      </div>

      <fieldset class="field-grid auth-fieldset">
        <legend>Change password</legend>

        <div class="field">
          <label for="current-password">Current password</label>
          <div class="password-field">
            <input
              id="current-password"
              v-model="form.currentPassword"
              class="control"
              :type="showCurrentPassword ? 'text' : 'password'"
              autocomplete="current-password"
            />
            <button
              type="button"
              class="password-toggle"
              :aria-label="showCurrentPassword ? 'Hide password' : 'Show password'"
              @click="showCurrentPassword = !showCurrentPassword"
            >
              <EyeOff v-if="showCurrentPassword" :size="16" aria-hidden="true" />
              <Eye v-else :size="16" aria-hidden="true" />
            </button>
          </div>
          <p v-if="errors.currentPassword" class="field-error" role="alert">
            {{ errors.currentPassword }}
          </p>
        </div>

        <div class="field">
          <label for="new-password">New password</label>
          <div class="password-field">
            <input
              id="new-password"
              v-model="form.password"
              class="control"
              :type="showNewPassword ? 'text' : 'password'"
              autocomplete="new-password"
            />
            <button
              type="button"
              class="password-toggle"
              :aria-label="showNewPassword ? 'Hide password' : 'Show password'"
              @click="showNewPassword = !showNewPassword"
            >
              <EyeOff v-if="showNewPassword" :size="16" aria-hidden="true" />
              <Eye v-else :size="16" aria-hidden="true" />
            </button>
          </div>
          <p v-if="errors.password" class="field-error" role="alert">{{ errors.password }}</p>
          <p class="hint">Leave both empty to keep your current password.</p>
        </div>
      </fieldset>

      <button type="submit" class="btn btn-block" :disabled="auth.isBusy">
        <span v-if="auth.isBusy" class="spinner" aria-hidden="true" />
        <Save v-else :size="16" aria-hidden="true" />
        Save changes
      </button>
    </form>
  </section>
</template>
