<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Eye, EyeOff, LogIn, UserPlus } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { useAuthStore } from '@/stores/auth.store'
import { MIN_PASSWORD_LENGTH } from '@/types/user'
import { AUTH_TOAST } from '@/services/toast-message.service'

type Mode = 'signin' | 'signup'

const router = useRouter()
const auth = useAuthStore()

const mode = ref<Mode>('signin')
const isSignup = computed(() => mode.value === 'signup')

const form = reactive({ name: '', email: '', password: '' })
const errors = reactive<Record<'name' | 'email' | 'password', string>>({
  name: '',
  email: '',
  password: ''
})

/**
 * One field serves both modes, so one ref is enough — but it resets whenever the field
 * changes purpose, so a reveal never outlives the action it was opened for.
 */
const showPassword = ref(false)

const passwordInput = ref<HTMLInputElement | null>(null)

/**
 * True until the visitor interacts with the password field. While true the input is
 * `readonly` (browsers do not autofill a readonly input) and wears `is-untouched`, which
 * hides any fill that still lands. Component-local, so every mount starts untouched —
 * including the one after logout.
 */
const isUntouched = ref(true)
const clearTimers: ReturnType<typeof setTimeout>[] = []

/**
 * Nothing in the app sets the password, so a value that shows up before the visitor
 * touched the field is the browser autofilling a saved credential. Browsers fill
 * after mount, so the check runs at mount and again shortly after.
 */
const AUTOFILL_CHECK_DELAYS_MS = [0, 100, 500, 1500]

function clearUntouchedPassword() {
  if (!isUntouched.value) return

  form.password = ''
  if (passwordInput.value) passwordInput.value.value = ''
}

function markPasswordTouched() {
  isUntouched.value = false
}

/** (Re)starts the clearing window; a previous one is cancelled first. */
function startClearWindow() {
  clearTimers.forEach(clearTimeout)
  clearTimers.length = 0

  for (const delay of AUTOFILL_CHECK_DELAYS_MS) {
    clearTimers.push(setTimeout(clearUntouchedPassword, delay))
  }
}

/**
 * Browser autofill sets the value and fires a bare `input` event, with no `beforeinput`.
 * Every user edit (typing, paste, drop, dictation, IME, replacement) fires `beforeinput`
 * first, so that is the signal that the visitor owns the value.
 */
function onBeforeInput() {
  markPasswordTouched()
}

onMounted(startClearWindow)

onBeforeUnmount(() => clearTimers.forEach(clearTimeout))

/** Deliberately loose: the API is the authority on what a valid address is. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function setMode(next: Mode) {
  mode.value = next
  clearErrors()
  showPassword.value = false
  // The same input changes purpose, and browsers may fill it again for the new mode.
  if (isUntouched.value) startClearWindow()
}

function clearErrors() {
  errors.name = ''
  errors.email = ''
  errors.password = ''
}

/** Catches the obvious mistakes locally so a typo costs a keystroke, not a round-trip. */
function validate(): boolean {
  clearErrors()

  if (isSignup.value && !form.name.trim()) errors.name = 'Enter your name.'

  const email = form.email.trim()
  if (!email) errors.email = 'Enter your email.'
  else if (!EMAIL_PATTERN.test(email)) errors.email = 'Enter a valid email address.'

  if (!form.password) errors.password = 'Enter your password.'
  else if (isSignup.value && form.password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`
  }

  return !errors.name && !errors.email && !errors.password
}

/** Long enough for any real name, short enough to keep the greeting one line. */
const MAX_GREETING_NAME = 40

/**
 * The API accepts a far longer name than a toast can show, and an account can carry a
 * blank one — neither should reach the greeting as-is.
 */
function greetingName(): string {
  const name = auth.user?.name?.trim()
  if (!name) return 'there'

  return name.length > MAX_GREETING_NAME ? `${name.slice(0, MAX_GREETING_NAME - 1)}…` : name
}

async function onSubmit() {
  // Submitting means the visitor owns whatever is in the field now.
  markPasswordTouched()
  if (!validate()) return

  const email = form.email.trim()

  const wasSignup = isSignup.value
  const ok = wasSignup
    ? await auth.signup({ email, name: form.name.trim(), password: form.password })
    : await auth.login({ email, password: form.password })

  // The store settled the outcome and computed the message; saying it is this screen's
  // job. `auth.error` is already user-safe copy, so the fallback is only ever a
  // belt-and-braces default.
  if (!ok) {
    toast.error(
      auth.error?.trim() || (wasSignup ? AUTH_TOAST.signupFailed : AUTH_TOAST.signinFailed)
    )
    return
  }

  const name = greetingName()
  toast.success(wasSignup ? AUTH_TOAST.welcome(name) : AUTH_TOAST.welcomeBack(name))

  form.password = ''
  showPassword.value = false
  await router.push({ name: 'home' })
}
</script>

<template>
  <section class="auth-page stack-lg">
    <header class="stack">
      <h1>{{ isSignup ? 'Create your account' : 'Sign in' }}</h1>
      <p class="text-muted">
        {{
          isSignup
            ? 'One account keeps your interviews and reports together.'
            : 'Sign in to practice an interview and pick up where you left off.'
        }}
      </p>
    </header>

    <div class="card stack-lg">
      <div class="auth-toggle" role="tablist" aria-label="Sign in or create an account">
        <button
          type="button"
          role="tab"
          class="auth-tab"
          :class="{ 'is-active': !isSignup }"
          :aria-selected="!isSignup"
          @click="setMode('signin')"
        >
          Sign in
        </button>
        <button
          type="button"
          role="tab"
          class="auth-tab"
          :class="{ 'is-active': isSignup }"
          :aria-selected="isSignup"
          @click="setMode('signup')"
        >
          Create account
        </button>
      </div>

      <form class="stack-lg" novalidate @submit.prevent="onSubmit">
        <div v-if="isSignup" class="field">
          <label for="name">Name</label>
          <input id="name" v-model="form.name" class="control" type="text" autocomplete="name" />
          <p v-if="errors.name" class="field-error" role="alert">{{ errors.name }}</p>
        </div>

        <div class="field">
          <label for="email">Email</label>
          <input id="email" v-model="form.email" class="control" type="email" autocomplete="email" />
          <p v-if="errors.email" class="field-error" role="alert">{{ errors.email }}</p>
        </div>

        <div class="field">
          <label for="password">Password</label>
          <div class="password-field">
            <input
              id="password"
              ref="passwordInput"
              v-model="form.password"
              class="control"
              :type="showPassword ? 'text' : 'password'"
              :autocomplete="isSignup ? 'new-password' : 'current-password'"
              :class="{ 'is-untouched': isUntouched }"
              :readonly="isUntouched"
              @focus="markPasswordTouched"
              @pointerdown="markPasswordTouched"
              @touchstart.passive="markPasswordTouched"
              @beforeinput="onBeforeInput"
              @keydown="markPasswordTouched"
              @paste="markPasswordTouched"
            />
            <button
              type="button"
              class="password-toggle"
              :aria-label="showPassword ? 'Hide password' : 'Show password'"
              @click="showPassword = !showPassword"
            >
              <EyeOff v-if="showPassword" :size="16" aria-hidden="true" />
              <Eye v-else :size="16" aria-hidden="true" />
            </button>
          </div>
          <p v-if="errors.password" class="field-error" role="alert">{{ errors.password }}</p>
          <p v-if="isSignup" class="hint">At least {{ MIN_PASSWORD_LENGTH }} characters.</p>
        </div>

        <button type="submit" class="btn btn-block" :disabled="auth.isBusy">
          <span v-if="auth.isBusy" class="spinner" aria-hidden="true" />
          <UserPlus v-else-if="isSignup" :size="16" aria-hidden="true" />
          <LogIn v-else :size="16" aria-hidden="true" />
          {{ isSignup ? 'Create account' : 'Sign in' }}
        </button>
      </form>
    </div>
  </section>
</template>
