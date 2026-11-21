<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AlertCircle, Camera, CheckCircle2, KeyRound } from 'lucide-vue-next'
import GuestHeader from '../components/GuestHeader.vue'
import { useSessionStore } from '../stores/sessionStore'
import type { AttendanceStatus } from '../types'

const sessionStore = useSessionStore()
const router = useRouter()
const route = useRoute()

const mode = ref<'register' | 'recover'>(
  route.query.mode === 'recover' ? 'recover' : 'register'
)

const form = reactive({
  fullName: '',
  attendance: 'attending' as AttendanceStatus,
  mediaAgreement: false
})

const recoveryForm = reactive({
  fullName: '',
  verificationInput: ''
})

const showRecoveryVerification = ref(false)
const errorMessage = ref('')
const isSubmitting = ref(false)
const isGoogleLoading = ref(false)
const googleLinkedEmail = ref('')

function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const msg = (err as { message?: unknown }).message
    if (typeof msg === 'string' && msg.trim().length > 0) return msg
  }
  return fallback
}

function switchMode(nextMode: 'register' | 'recover') {
  mode.value = nextMode
  errorMessage.value = ''
  if (nextMode === 'register') {
    showRecoveryVerification.value = false
  }
}

onMounted(async () => {
  if (!sessionStore.isHydrated) {
    await sessionStore.hydrateGuestSession()
  }
})

watch(
  () => route.query.mode,
  (newMode) => {
    switchMode(newMode === 'recover' ? 'recover' : 'register')
  }
)

async function handleGoogleGuestSignIn() {
  errorMessage.value = ''
  isGoogleLoading.value = true
  try {
    const profile = await sessionStore.authenticateGuestWithGoogle()
    googleLinkedEmail.value = profile.email

    // Try opening an existing roll linked to this Google account first
    try {
      await sessionStore.recoverExistingGuest(profile.fullName, profile.email)
      router.push('/camera')
      return
    } catch {
      // No existing registration yet -> pre-fill name for quick start
    }

    if (mode.value === 'recover') {
      recoveryForm.fullName = profile.fullName
      recoveryForm.verificationInput = profile.email
      mode.value = 'register'
    }

    if (!form.fullName) {
      form.fullName = profile.fullName
    }
  } catch (err: unknown) {
    errorMessage.value = extractErrorMessage(err, 'Google Sign-In failed. Please try again.')
  } finally {
    isGoogleLoading.value = false
  }
}

async function handleRegistrationSubmit() {
  errorMessage.value = ''
  isSubmitting.value = true
  try {
    await sessionStore.registerNewGuest({
      fullName: form.fullName,
      email: googleLinkedEmail.value || '',
      attendance: form.attendance,
      mediaAgreement: form.mediaAgreement
    })
    router.push('/camera')
  } catch (err: unknown) {
    errorMessage.value = extractErrorMessage(err, 'Could not start camera. Please try again.')
  } finally {
    isSubmitting.value = false
  }
}

async function handleRecoverySubmit() {
  errorMessage.value = ''
  isSubmitting.value = true
  try {
    await sessionStore.recoverExistingGuest(
      recoveryForm.fullName,
      recoveryForm.verificationInput
    )
    router.push('/camera')
  } catch (err: unknown) {
    const msg = extractErrorMessage(err, 'We could not find a camera under that name.')
    if (msg.toLowerCase().includes('verification')) {
      showRecoveryVerification.value = true
    }
    errorMessage.value = msg
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <div class="register-page">
    <GuestHeader />

    <main class="register-main">
      <section class="auth-card">
        <!-- HEADER -->
        <header class="card-header">
          <h1>{{ mode === 'register' ? 'Get Your Camera' : 'Welcome Back' }}</h1>
          <p>
            {{
              mode === 'register'
                ? '10 free disposable camera shots for tonight’s party.'
                : 'Enter your name to return to your camera.'
            }}
          </p>
        </header>

        <!-- ACTIVE SESSION SHORTCUT -->
        <div v-if="sessionStore.hasActiveGuestSession" class="active-session-bar">
          <div class="session-info">
            <CheckCircle2 :size="18" class="session-icon" />
            <div>
              <strong>{{ sessionStore.guest?.fullName }}</strong>
              <span>{{ sessionStore.remainingShots }} of {{ sessionStore.totalShots }} shots left</span>
            </div>
          </div>
          <button type="button" class="btn btn-primary btn-compact" @click="router.push('/camera')">
            Open
          </button>
        </div>

        <!-- ERROR MESSAGE -->
        <div v-if="errorMessage" class="error-box" role="alert">
          <AlertCircle :size="18" class="err-icon" />
          <div class="err-content">
            <span>{{ errorMessage }}</span>
            <button
              v-if="mode === 'register' && errorMessage.toLowerCase().includes('already registered')"
              type="button"
              class="inline-link"
              @click="
                recoveryForm.fullName = form.fullName;
                recoveryForm.verificationInput = googleLinkedEmail;
                switchMode('recover')
              "
            >
              Open your existing camera →
            </button>
          </div>
        </div>

        <!-- GOOGLE SIGN-IN -->
        <button
          type="button"
          class="google-btn"
          :disabled="isSubmitting || isGoogleLoading"
          data-testid="google-guest-signin-btn"
          @click="handleGoogleGuestSignIn"
        >
          <svg class="google-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
            />
            <path
              fill="#34A853"
              d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"
            />
            <path
              fill="#FBBC05"
              d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"
            />
            <path
              fill="#EA4335"
              d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"
            />
          </svg>
          <span>
            {{ isGoogleLoading ? 'Connecting...' : 'Continue with Google' }}
          </span>
        </button>

        <div v-if="googleLinkedEmail" class="google-pill">
          <CheckCircle2 :size="15" />
          <span>Signed in as {{ googleLinkedEmail }}</span>
        </div>

        <div class="divider">
          <span>or</span>
        </div>

        <!-- NEW GUEST FORM -->
        <form
          v-if="mode === 'register'"
          class="simple-form"
          @submit.prevent="handleRegistrationSubmit"
        >
          <div v-if="!sessionStore.event.registrationOpen" class="closed-notice">
            Registration is currently closed.
          </div>

          <div class="field">
            <label for="fullName" class="field-label">Your Name</label>
            <input
              id="fullName"
              v-model="form.fullName"
              type="text"
              class="field-input"
              placeholder="Enter your name"
              required
              autocomplete="name"
              :disabled="!sessionStore.event.registrationOpen || isSubmitting"
            />
          </div>

          <div class="field">
            <span class="field-label">Are you attending?</span>
            <div class="choice-row">
              <label class="choice-pill" :class="{ active: form.attendance === 'attending' }">
                <input
                  v-model="form.attendance"
                  type="radio"
                  name="attendance"
                  value="attending"
                  :disabled="!sessionStore.event.registrationOpen || isSubmitting"
                />
                <span>Yes, attending</span>
              </label>

              <label class="choice-pill" :class="{ active: form.attendance === 'not_attending' }">
                <input
                  v-model="form.attendance"
                  type="radio"
                  name="attendance"
                  value="not_attending"
                  :disabled="!sessionStore.event.registrationOpen || isSubmitting"
                />
                <span>Not attending</span>
              </label>
            </div>
          </div>

          <label class="consent-row">
            <input
              v-model="form.mediaAgreement"
              type="checkbox"
              required
              :disabled="!sessionStore.event.registrationOpen || isSubmitting"
            />
            <span>I agree to share my photos in the party gallery.</span>
          </label>

          <button
            type="submit"
            class="btn btn-red submit-btn"
            :disabled="!sessionStore.event.registrationOpen || isSubmitting"
          >
            <Camera :size="18" />
            <span>{{ isSubmitting ? 'Starting...' : 'Start Camera' }}</span>
          </button>
        </form>

        <!-- RETURNING GUEST FORM -->
        <form v-else class="simple-form" @submit.prevent="handleRecoverySubmit">
          <div class="field">
            <label for="recoverName" class="field-label">Your Name</label>
            <input
              id="recoverName"
              v-model="recoveryForm.fullName"
              type="text"
              class="field-input"
              placeholder="Name you registered with"
              required
              autocomplete="name"
              :disabled="isSubmitting"
            />
          </div>

          <div v-if="showRecoveryVerification" class="field">
            <label for="recoverVerify" class="field-label">Email or Phone Used</label>
            <input
              id="recoverVerify"
              v-model="recoveryForm.verificationInput"
              type="text"
              class="field-input"
              placeholder="Enter email or phone"
              :disabled="isSubmitting"
            />
          </div>

          <button type="submit" class="btn btn-primary submit-btn" :disabled="isSubmitting">
            <KeyRound :size="18" />
            <span>{{ isSubmitting ? 'Opening...' : 'Open My Camera' }}</span>
          </button>
        </form>

        <!-- SIMPLE FOOTER MODE SWITCH -->
        <footer class="card-footer">
          <template v-if="mode === 'register'">
            <span>Already registered?</span>
            <button type="button" class="footer-link" @click="switchMode('recover')">
              Open my camera
            </button>
          </template>
          <template v-else>
            <span>New here?</span>
            <button type="button" class="footer-link" @click="switchMode('register')">
              Get a camera
            </button>
          </template>
        </footer>
      </section>
    </main>
  </div>
</template>

<style scoped lang="scss">
.register-page {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
}

.register-main {
  flex: 1;
  width: 100%;
  max-width: 440px;
  margin: 0 auto;
  padding: 1.5rem 1rem 3rem;
  display: flex;
  align-items: center;
}

.auth-card {
  width: 100%;
  background: var(--bg-cream-elevated);
  border: 1px solid var(--charcoal-border);
  border-radius: 20px;
  padding: 1.75rem 1.4rem;
  box-shadow: 0 10px 30px -12px rgba(24, 61, 50, 0.14);
  display: flex;
  flex-direction: column;
  gap: 1.15rem;
}

.card-header {
  text-align: center;

  h1 {
    font-size: 1.7rem;
    color: var(--forest-green);
    line-height: 1.15;
  }

  p {
    margin-top: 0.35rem;
    font-size: 0.9rem;
    color: var(--charcoal-muted);
  }
}

.active-session-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.75rem 0.9rem;
  border-radius: 12px;
  background: var(--forest-green-subtle);
}

.session-info {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  min-width: 0;

  .session-icon {
    color: var(--forest-green);
    flex-shrink: 0;
  }

  strong {
    display: block;
    font-size: 0.9rem;
    color: var(--forest-green);
    line-height: 1.2;
  }

  span {
    display: block;
    font-size: 0.78rem;
    color: var(--charcoal-soft);
  }
}

.btn-compact {
  padding: 0.45rem 0.95rem;
  font-size: 0.84rem;
}

.error-box {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.75rem 0.9rem;
  border-radius: 12px;
  background: var(--xmas-red-subtle);
  color: var(--xmas-red-dark);
  font-size: 0.85rem;

  .err-icon {
    flex-shrink: 0;
    margin-top: 2px;
  }

  .err-content {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .inline-link {
    align-self: flex-start;
    font-weight: 700;
    font-size: 0.82rem;
    color: var(--forest-green);
    text-decoration: underline;
  }
}

.google-btn {
  width: 100%;
  min-height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.65rem;
  background: #fff;
  color: #1f1f1f;
  border: 1.5px solid var(--charcoal-border);
  border-radius: 12px;
  font-weight: 600;
  font-size: 0.94rem;
  transition: border-color 0.15s ease, background-color 0.15s ease;

  &:hover:not(:disabled) {
    background: #fafafa;
    border-color: var(--forest-green);
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .google-icon {
    width: 19px;
    height: 19px;
    flex-shrink: 0;
  }
}

.google-pill {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  font-size: 0.8rem;
  color: var(--forest-green);
  background: var(--forest-green-subtle);
  padding: 0.45rem 0.75rem;
  border-radius: 10px;
}

.divider {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.8rem;
  color: var(--charcoal-muted);

  &::before,
  &::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--charcoal-border);
  }
}

.simple-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.closed-notice {
  padding: 0.7rem 0.85rem;
  background: var(--muted-gold-subtle);
  border-radius: 10px;
  font-size: 0.85rem;
  color: #7c5819;
  text-align: center;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.field-label {
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--charcoal);
}

.field-input {
  width: 100%;
  min-height: 48px;
  padding: 0.75rem 0.95rem;
  background: #fff;
  border: 1.5px solid var(--charcoal-border);
  border-radius: 12px;
  color: var(--charcoal);
  font-size: 0.96rem;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;

  &:focus {
    outline: none;
    border-color: var(--forest-green);
    box-shadow: 0 0 0 3px rgba(24, 61, 50, 0.12);
  }

  &::placeholder {
    color: var(--charcoal-muted);
    opacity: 0.7;
  }
}

.choice-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
}

.choice-pill {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0.5rem 0.75rem;
  border-radius: 12px;
  border: 1.5px solid var(--charcoal-border);
  background: #fff;
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--charcoal-soft);
  cursor: pointer;
  white-space: nowrap;
  transition: border-color 0.15s ease, background-color 0.15s ease, color 0.15s ease;

  input {
    display: none;
  }

  &.active {
    border-color: var(--forest-green);
    background: var(--forest-green);
    color: var(--bg-cream);
  }
}

.consent-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-size: 0.85rem;
  color: var(--charcoal-soft);
  cursor: pointer;
  padding: 0.15rem 0;

  input {
    width: 18px;
    height: 18px;
    accent-color: var(--forest-green);
    flex-shrink: 0;
    cursor: pointer;
  }
}

.submit-btn {
  width: 100%;
  min-height: 50px;
  font-size: 0.98rem;
  border-radius: 12px;
}

.card-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  padding-top: 0.25rem;
  font-size: 0.86rem;
  color: var(--charcoal-muted);
}

.footer-link {
  font-weight: 700;
  color: var(--forest-green);
  text-decoration: underline;
}
</style>
