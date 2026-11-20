<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { AlertCircle, ArrowLeft, CheckCircle2, KeyRound, Lock, ShieldCheck } from 'lucide-vue-next'
import { firebaseConfig, getAuthorizedAdminEmails, isFirebaseConfigured } from '@/services/firebase'
import { useSessionStore } from '@/stores/sessionStore'

const sessionStore = useSessionStore()
const router = useRouter()

const allowedEmails = getAuthorizedAdminEmails()

const form = reactive({
  email: isFirebaseConfigured ? '' : allowedEmails[0] || 'organizer@xmasroll.local',
  password: ''
})

const errorMessage = ref('')
const isSubmitting = ref(false)
const isGoogleSubmitting = ref(false)

onMounted(async () => {
  const existing = await sessionStore.hydrateAdminAuth()
  if (existing?.isAdminVerified) {
    router.replace('/admin/dashboard')
  }
})

async function handleGoogleLogin() {
  errorMessage.value = ''
  isGoogleSubmitting.value = true
  try {
    await sessionStore.loginAdminWithGoogle()
    router.push('/admin/dashboard')
  } catch (err: any) {
    errorMessage.value = err?.message || 'Google Sign-In failed.'
  } finally {
    isGoogleSubmitting.value = false
  }
}

async function handleLogin() {
  errorMessage.value = ''
  isSubmitting.value = true
  try {
    await sessionStore.loginAdmin(form.email, form.password)
    router.push('/admin/dashboard')
  } catch (err: any) {
    errorMessage.value = err?.message || 'Admin login failed.'
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <div class="admin-login-page">
    <div class="film-sprocket-bar" aria-hidden="true"></div>

    <main class="login-main">
      <div class="login-card retro-card">
        <RouterLink to="/" class="back-link font-mono">
          <ArrowLeft :size="15" />
          <span>Back to Home</span>
        </RouterLink>

        <div class="login-header">
          <div class="shield-badge">
            <ShieldCheck :size="24" />
          </div>
          <h1>Admin Login</h1>
          <p>Sign in to view photos, guests, QR code, and ZIP download.</p>
        </div>

        <div v-if="isFirebaseConfigured" class="firebase-status-box font-mono">
          <CheckCircle2 :size="14" class="status-icon" />
          <span>
            Connected to Firebase: <strong>{{ firebaseConfig.projectId }}</strong>
          </span>
        </div>

        <div v-else class="infra-status-box font-mono">
          <strong>Local Dev Mode:</strong> Use <u>{{ allowedEmails[0] }}</u> and any 6+ char
          password.
        </div>

        <div v-if="errorMessage" class="error-box" role="alert">
          <AlertCircle :size="18" />
          <span>{{ errorMessage }}</span>
        </div>

        <!-- GOOGLE SIGN-IN BUTTON -->
        <button
          type="button"
          class="btn google-signin-btn"
          :disabled="isSubmitting || isGoogleSubmitting"
          data-testid="google-admin-signin-btn"
          @click="handleGoogleLogin"
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
          <span>{{ isGoogleSubmitting ? 'Signing in with Google...' : 'Sign in with Google' }}</span>
        </button>

        <div class="auth-divider font-mono">
          <span>OR SIGN IN WITH EMAIL</span>
        </div>

        <form class="login-form" @submit.prevent="handleLogin">
          <div class="form-group">
            <label for="adminEmail" class="form-label">Admin Email</label>
            <input
              id="adminEmail"
              v-model="form.email"
              type="email"
              class="form-input"
              placeholder="mazi39662@gmail.com"
              required
              autocomplete="username"
              :disabled="isSubmitting || isGoogleSubmitting"
            />
          </div>

          <div class="form-group">
            <label for="adminPassword" class="form-label">Password</label>
            <input
              id="adminPassword"
              v-model="form.password"
              type="password"
              class="form-input"
              placeholder="Enter password"
              required
              autocomplete="current-password"
              :disabled="isSubmitting || isGoogleSubmitting"
            />
          </div>

          <button
            type="submit"
            class="btn btn-primary login-btn"
            :disabled="isSubmitting || isGoogleSubmitting"
          >
            <Lock v-if="isFirebaseConfigured" :size="18" />
            <KeyRound v-else :size="18" />
            <span>{{ isSubmitting ? 'Signing In...' : 'Sign In with Email' }}</span>
          </button>
        </form>
      </div>
    </main>
  </div>
</template>

<style scoped lang="scss">
.admin-login-page {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--bg-cream);
}

.login-main {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.25rem 0.85rem;
}

.login-card {
  width: 100%;
  max-width: 420px;
  padding: 1.5rem 1.25rem;
  border-top: 5px solid var(--forest-green);
}

.back-link {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.75rem;
  color: var(--charcoal-muted);
  margin-bottom: 1rem;
}

.login-header {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.35rem;
  margin-bottom: 1rem;

  .shield-badge {
    width: 42px;
    height: 42px;
    border-radius: 12px;
    background: var(--forest-green);
    color: var(--bg-cream);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  h1 {
    font-size: 1.65rem;
    color: var(--forest-green);
  }

  p {
    font-size: 0.85rem;
    color: var(--charcoal-soft);
  }
}

.firebase-status-box {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  background: var(--forest-green-subtle);
  border: 1px solid rgba(24, 61, 50, 0.25);
  border-radius: var(--radius-md);
  padding: 0.6rem 0.85rem;
  font-size: 0.72rem;
  margin-bottom: 1rem;
  color: var(--forest-green);

  .status-icon {
    flex-shrink: 0;
    color: var(--forest-green);
  }
}

.infra-status-box {
  background: var(--muted-gold-subtle);
  border: 1px solid rgba(199, 166, 106, 0.55);
  border-radius: var(--radius-md);
  padding: 0.65rem 0.85rem;
  font-size: 0.72rem;
  margin-bottom: 1rem;
  color: var(--charcoal);
}

.error-box {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.75rem 0.85rem;
  border-radius: var(--radius-md);
  background: var(--xmas-red-subtle);
  border: 1px solid rgba(181, 59, 53, 0.35);
  color: var(--xmas-red-dark);
  font-size: 0.84rem;
  margin-bottom: 1rem;
}

.google-signin-btn {
  width: 100%;
  min-height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.65rem;
  background: #ffffff;
  color: #1f1f1f;
  border: 1.5px solid var(--charcoal-border);
  border-radius: var(--radius-md);
  font-weight: 700;
  font-size: 0.94rem;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05);
  transition: all 0.15s ease;

  &:hover:not(:disabled) {
    background: #f8f9fa;
    border-color: var(--forest-green);
    transform: translateY(-1px);
  }

  .google-icon {
    width: 19px;
    height: 19px;
    flex-shrink: 0;
  }
}

.auth-divider {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  margin: 1rem 0;
  color: var(--charcoal-muted);
  font-size: 0.68rem;
  letter-spacing: 0.05em;

  &::before,
  &::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--charcoal-border);
  }
}

.login-btn {
  width: 100%;
  min-height: 48px;
}
</style>
