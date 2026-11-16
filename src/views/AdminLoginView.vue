<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { AlertCircle, ArrowLeft, KeyRound, Lock, ShieldCheck } from 'lucide-vue-next'
import { getAuthorizedAdminEmails, isFirebaseConfigured } from '@/services/firebase'
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

onMounted(async () => {
  const existing = await sessionStore.hydrateAdminAuth()
  if (existing?.isAdminVerified) {
    router.replace('/admin/dashboard')
  }
})

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

        <div v-if="!isFirebaseConfigured" class="infra-status-box font-mono">
          <strong>Local Dev Mode:</strong> Use <u>{{ allowedEmails[0] }}</u> and any 6+ char
          password.
        </div>

        <div v-if="errorMessage" class="error-box" role="alert">
          <AlertCircle :size="18" />
          <span>{{ errorMessage }}</span>
        </div>

        <form class="login-form" @submit.prevent="handleLogin">
          <div class="form-group">
            <label for="adminEmail" class="form-label">Admin Email</label>
            <input
              id="adminEmail"
              v-model="form.email"
              type="email"
              class="form-input"
              placeholder="organizer@xmasroll.local"
              required
              autocomplete="username"
              :disabled="isSubmitting"
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
              :disabled="isSubmitting"
            />
          </div>

          <button type="submit" class="btn btn-primary login-btn" :disabled="isSubmitting">
            <Lock v-if="isFirebaseConfigured" :size="18" />
            <KeyRound v-else :size="18" />
            <span>{{ isSubmitting ? 'Signing In...' : 'Sign In' }}</span>
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
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 0.85rem;
  border-radius: var(--radius-md);
  background: var(--xmas-red-subtle);
  border: 1px solid rgba(181, 59, 53, 0.35);
  color: var(--xmas-red-dark);
  font-size: 0.84rem;
  margin-bottom: 1rem;
}

.login-btn {
  width: 100%;
  min-height: 48px;
}
</style>
