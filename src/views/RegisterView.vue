<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AlertCircle,
  ArrowRight,
  Camera,
  CheckCircle2,
  KeyRound,
  UserCheck
} from 'lucide-vue-next'
import GuestHeader from '@/components/GuestHeader.vue'
import { useSessionStore } from '@/stores/sessionStore'
import type { AttendanceStatus } from '@/types'

const sessionStore = useSessionStore()
const router = useRouter()
const route = useRoute()

const mode = ref<'register' | 'recover'>(
  route.query.mode === 'recover' ? 'recover' : 'register'
)

const form = reactive({
  fullName: '',
  contactNumber: '',
  email: '',
  department: '',
  attendance: 'attending' as AttendanceStatus,
  mediaAgreement: false
})

const recoveryForm = reactive({
  fullName: '',
  verificationInput: ''
})

const errorMessage = ref('')
const isSubmitting = ref(false)
const isGoogleLoading = ref(false)
const googleLinkedEmail = ref('')

const departmentSuggestions = [
  'Operations',
  'Marketing',
  'Leasing',
  'Finance',
  'Engineering',
  'IT',
  'HR',
  'Admin'
]

onMounted(async () => {
  if (!sessionStore.isHydrated) {
    await sessionStore.hydrateGuestSession()
  }
})

watch(
  () => route.query.mode,
  (newMode) => {
    mode.value = newMode === 'recover' ? 'recover' : 'register'
    errorMessage.value = ''
  }
)

async function handleGoogleGuestSignIn() {
  errorMessage.value = ''
  isGoogleLoading.value = true
  try {
    const profile = await sessionStore.authenticateGuestWithGoogle()
    googleLinkedEmail.value = profile.email

    // Try recovering an existing camera roll if one was already registered under this Google account
    try {
      await sessionStore.recoverExistingGuest(profile.fullName, profile.email)
      router.push('/camera')
      return
    } catch {
      // No existing registration found yet -> populate the form for quick registration
    }

    if (mode.value === 'recover') {
      recoveryForm.fullName = profile.fullName
      recoveryForm.verificationInput = profile.email
      mode.value = 'register'
    }

    if (!form.fullName) {
      form.fullName = profile.fullName
    }
    if (profile.email) {
      form.email = profile.email
    }
  } catch (err: any) {
    errorMessage.value = err?.message || 'Google Sign-In failed. Please try again.'
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
      contactNumber: form.contactNumber,
      email: form.email,
      department: form.department,
      attendance: form.attendance,
      mediaAgreement: form.mediaAgreement
    })
    router.push('/camera')
  } catch (err: any) {
    errorMessage.value = err?.message || 'Registration failed. Please try again.'
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
  } catch (err: any) {
    errorMessage.value = err?.message || 'Camera session not found.'
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <div class="register-page">
    <GuestHeader />
    <div class="film-sprocket-bar" aria-hidden="true"></div>

    <main class="register-main">
      <div class="ticket-wrapper retro-card">
        <div class="ticket-header">
          <span class="badge badge-red">10 SHOTS INCLUDED</span>
          <h1>Get Your Camera</h1>
          <p>{{ sessionStore.event.name }} · {{ sessionStore.event.venue }}</p>
        </div>

        <!-- Existing Active Session Notice -->
        <div v-if="sessionStore.hasActiveGuestSession" class="already-registered-banner">
          <div class="banner-info">
            <CheckCircle2 :size="18" class="banner-icon" />
            <div>
              <strong>{{ sessionStore.guest?.fullName }}</strong>
              <p>{{ sessionStore.remainingShots }} / {{ sessionStore.totalShots }} shots left</p>
            </div>
          </div>
          <button class="btn btn-primary btn-sm" @click="router.push('/camera')">
            <Camera :size="16" />
            <span>Open Camera</span>
          </button>
        </div>

        <!-- Mode Tabs -->
        <div class="mode-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            class="mode-tab"
            :class="{ active: mode === 'register' }"
            @click="mode = 'register'; errorMessage = ''"
          >
            <UserCheck :size="15" />
            <span>New Guest</span>
          </button>
          <button
            type="button"
            role="tab"
            class="mode-tab"
            :class="{ active: mode === 'recover' }"
            @click="mode = 'recover'; errorMessage = ''"
          >
            <KeyRound :size="15" />
            <span>Already Registered</span>
          </button>
        </div>

        <!-- Error Alert -->
        <div v-if="errorMessage" class="error-banner" role="alert">
          <AlertCircle :size="18" class="err-icon" />
          <div class="err-body">
            <span>{{ errorMessage }}</span>
            <button
              v-if="mode === 'register' && errorMessage.includes('already registered')"
              type="button"
              class="inline-recover-btn"
              @click="
                recoveryForm.fullName = form.fullName;
                recoveryForm.verificationInput = form.email || form.contactNumber;
                mode = 'recover';
                errorMessage = ''
              "
            >
              Tap here to open your existing camera &rarr;
            </button>
          </div>
        </div>

        <!-- GOOGLE QUICK SIGN-IN -->
        <div class="google-auth-section">
          <button
            type="button"
            class="btn google-guest-btn"
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
              {{
                isGoogleLoading
                  ? 'Connecting with Google...'
                  : mode === 'recover'
                    ? 'Open Camera with Google'
                    : 'Continue with Google'
              }}
            </span>
          </button>

          <div v-if="googleLinkedEmail" class="google-linked-pill font-mono">
            <CheckCircle2 :size="14" />
            <span>Signed in as {{ googleLinkedEmail }}</span>
          </div>

          <div class="or-divider font-mono">
            <span>OR ENTER DETAILS BELOW</span>
          </div>
        </div>

        <!-- REGISTRATION FORM -->
        <form
          v-if="mode === 'register'"
          class="ticket-form"
          @submit.prevent="handleRegistrationSubmit"
        >
          <div v-if="!sessionStore.event.registrationOpen" class="closed-notice">
            Registration is currently closed.
          </div>

          <div class="form-group">
            <label for="fullName" class="form-label">Full Name *</label>
            <input
              id="fullName"
              v-model="form.fullName"
              type="text"
              class="form-input"
              placeholder="Enter your full name"
              required
              autocomplete="name"
              :disabled="!sessionStore.event.registrationOpen || isSubmitting"
            />
          </div>

          <div class="form-group">
            <label for="department" class="form-label">Department / Team (Optional)</label>
            <input
              id="department"
              v-model="form.department"
              type="text"
              list="dept-options"
              class="form-input"
              placeholder="e.g. Marketing, Operations"
              :disabled="!sessionStore.event.registrationOpen || isSubmitting"
            />
            <datalist id="dept-options">
              <option v-for="dept in departmentSuggestions" :key="dept" :value="dept" />
            </datalist>
          </div>

          <div class="form-row-2">
            <div class="form-group">
              <label for="contactNumber" class="form-label">Mobile No. (Optional)</label>
              <input
                id="contactNumber"
                v-model="form.contactNumber"
                type="tel"
                class="form-input"
                placeholder="0917 123 4567"
                autocomplete="tel"
                :disabled="!sessionStore.event.registrationOpen || isSubmitting"
              />
            </div>

            <div class="form-group">
              <label for="email" class="form-label">Email (Optional)</label>
              <input
                id="email"
                v-model="form.email"
                type="email"
                class="form-input"
                placeholder="you@email.com"
                autocomplete="email"
                :disabled="!sessionStore.event.registrationOpen || isSubmitting"
              />
            </div>
          </div>

          <!-- Attendance Confirmation -->
          <div class="form-group">
            <span class="form-label">Are You Attending? *</span>
            <div class="attendance-grid">
              <label
                class="attendance-option"
                :class="{ selected: form.attendance === 'attending' }"
              >
                <input
                  v-model="form.attendance"
                  type="radio"
                  name="attendance"
                  value="attending"
                  :disabled="!sessionStore.event.registrationOpen || isSubmitting"
                />
                <span class="att-title">🎉 Yes, Attending</span>
              </label>

              <label
                class="attendance-option"
                :class="{ selected: form.attendance === 'not_attending' }"
              >
                <input
                  v-model="form.attendance"
                  type="radio"
                  name="attendance"
                  value="not_attending"
                  :disabled="!sessionStore.event.registrationOpen || isSubmitting"
                />
                <span class="att-title">💌 Not Attending</span>
              </label>
            </div>
          </div>

          <!-- Media Agreement -->
          <label class="agreement-box">
            <input
              v-model="form.mediaAgreement"
              type="checkbox"
              required
              :disabled="!sessionStore.event.registrationOpen || isSubmitting"
            />
            <span class="agreement-text">
              I agree to share my photos in the Christmas party gallery &amp; slideshow. *
            </span>
          </label>

          <button
            type="submit"
            class="btn btn-red submit-btn"
            :disabled="!sessionStore.event.registrationOpen || isSubmitting"
          >
            <Camera :size="19" />
            <span>{{ isSubmitting ? 'Loading Camera...' : 'Start Camera (10 Shots)' }}</span>
            <ArrowRight :size="18" />
          </button>
        </form>

        <!-- RECOVER EXISTING CAMERA FORM -->
        <form v-else class="ticket-form" @submit.prevent="handleRecoverySubmit">
          <p class="recovery-intro">
            Enter the name you registered with to return to your camera.
          </p>

          <div class="form-group">
            <label for="recoverName" class="form-label">Full Name *</label>
            <input
              id="recoverName"
              v-model="recoveryForm.fullName"
              type="text"
              class="form-input"
              placeholder="Your registered name"
              required
              :disabled="isSubmitting"
            />
          </div>

          <div class="form-group">
            <label for="recoverVerify" class="form-label">
              Mobile No. or Email (if provided)
            </label>
            <input
              id="recoverVerify"
              v-model="recoveryForm.verificationInput"
              type="text"
              class="form-input"
              placeholder="Optional verification"
              :disabled="isSubmitting"
            />
          </div>

          <button type="submit" class="btn btn-primary submit-btn" :disabled="isSubmitting">
            <KeyRound :size="18" />
            <span>{{ isSubmitting ? 'Opening...' : 'Open My Camera' }}</span>
          </button>
        </form>
      </div>
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
  max-width: 520px;
  width: 100%;
  margin: 0 auto;
  padding: 1rem 0.85rem 2.5rem;
}

.ticket-wrapper {
  padding: 1.35rem 1.15rem;
  border-top: 5px solid var(--forest-green);
}

.ticket-header {
  margin-bottom: 1.1rem;

  h1 {
    font-size: 1.65rem;
    color: var(--forest-green);
    margin: 0.35rem 0 0.15rem;
  }

  p {
    color: var(--charcoal-muted);
    font-size: 0.85rem;
  }
}

.already-registered-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.75rem 0.9rem;
  border-radius: var(--radius-md);
  background: var(--forest-green-subtle);
  border: 1px solid rgba(24, 61, 50, 0.25);
  margin-bottom: 1rem;

  .banner-info {
    display: flex;
    align-items: center;
    gap: 0.55rem;

    .banner-icon {
      color: var(--forest-green);
      flex-shrink: 0;
    }

    strong {
      display: block;
      font-size: 0.88rem;
      color: var(--forest-green);
    }

    p {
      font-size: 0.76rem;
      color: var(--charcoal-soft);
    }
  }
}

.btn-sm {
  padding: 0.45rem 0.85rem;
  font-size: 0.82rem;
}

.mode-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.35rem;
  background: var(--bg-cream-muted);
  padding: 0.3rem;
  border-radius: var(--radius-md);
  margin-bottom: 1.1rem;
}

.mode-tab {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  min-height: 40px;
  padding: 0.5rem;
  border-radius: var(--radius-sm);
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--charcoal-soft);

  &.active {
    background: var(--bg-cream-elevated);
    color: var(--forest-green);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
  }
}

.error-banner {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  padding: 0.8rem 0.9rem;
  border-radius: var(--radius-md);
  background: var(--xmas-red-subtle);
  border: 1px solid rgba(181, 59, 53, 0.35);
  color: var(--xmas-red-dark);
  font-size: 0.84rem;
  margin-bottom: 1rem;

  .err-icon {
    flex-shrink: 0;
    margin-top: 1px;
  }

  .err-body {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .inline-recover-btn {
    align-self: flex-start;
    font-weight: 700;
    font-size: 0.8rem;
    color: var(--forest-green);
    text-decoration: underline;
  }
}

.closed-notice {
  padding: 0.75rem 0.9rem;
  background: var(--muted-gold-subtle);
  border: 1px solid var(--muted-gold);
  border-radius: var(--radius-md);
  font-size: 0.84rem;
  margin-bottom: 1rem;
}

.google-auth-section {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  margin-bottom: 0.85rem;
}

.google-guest-btn {
  width: 100%;
  min-height: 46px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.65rem;
  background: #ffffff;
  color: #1f1f1f;
  border: 1.5px solid var(--charcoal-border);
  border-radius: var(--radius-md);
  font-weight: 700;
  font-size: 0.92rem;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05);
  transition: all 0.15s ease;

  &:hover:not(:disabled) {
    background: #f8f9fa;
    border-color: var(--forest-green);
    transform: translateY(-1px);
  }

  .google-icon {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
  }
}

.google-linked-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.74rem;
  color: var(--forest-green);
  background: var(--forest-green-subtle);
  border: 1px solid rgba(24, 61, 50, 0.25);
  padding: 0.45rem 0.75rem;
  border-radius: var(--radius-sm);
}

.or-divider {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-size: 0.68rem;
  color: var(--charcoal-muted);
  letter-spacing: 0.05em;

  &::before,
  &::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--charcoal-border);
  }
}

.form-row-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.attendance-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.6rem;
}

.attendance-option {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 46px;
  padding: 0.65rem 0.75rem;
  border-radius: var(--radius-md);
  border: 1.5px solid var(--charcoal-border);
  background: var(--bg-cream);
  cursor: pointer;
  text-align: center;

  input {
    display: none;
  }

  .att-title {
    font-weight: 700;
    font-size: 0.86rem;
    color: var(--charcoal);
  }

  &.selected {
    border-color: var(--forest-green);
    background: var(--forest-green-subtle);

    .att-title {
      color: var(--forest-green);
    }
  }
}

.agreement-box {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.75rem 0.85rem;
  background: var(--bg-cream);
  border: 1px solid var(--charcoal-border);
  border-radius: var(--radius-md);
  margin: 0.25rem 0 1.1rem;
  cursor: pointer;

  input {
    width: 20px;
    height: 20px;
    accent-color: var(--forest-green);
    flex-shrink: 0;
  }

  .agreement-text {
    font-size: 0.82rem;
    color: var(--charcoal-soft);
    line-height: 1.35;
  }
}

.submit-btn {
  width: 100%;
  min-height: 50px;
  font-size: 1rem;
}

.recovery-intro {
  font-size: 0.86rem;
  color: var(--charcoal-soft);
  margin-bottom: 1rem;
}

@media (max-width: 520px) {
  .form-row-2 {
    grid-template-columns: 1fr;
    gap: 0;
  }
}
</style>
