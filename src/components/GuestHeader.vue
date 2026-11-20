<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { Camera, Film, Home, ShieldCheck } from 'lucide-vue-next'
import { useSessionStore } from '@/stores/sessionStore'

const sessionStore = useSessionStore()
const route = useRoute()

const shotBadgeText = computed(() => {
  if (!sessionStore.hasActiveGuestSession) {
    return '10 SHOTS'
  }
  return `${sessionStore.remainingShots}/${sessionStore.totalShots} SHOTS`
})
</script>

<template>
  <header class="guest-header">
    <div class="header-inner">
      <RouterLink to="/" class="brand-link">
        <span class="brand-film-tag">35MM</span>
        <span class="brand-title">XMAS ROLL</span>
      </RouterLink>

      <div class="header-actions">
        <RouterLink
          v-if="sessionStore.hasActiveGuestSession"
          to="/camera"
          class="shot-counter-pill"
          :class="{ exhausted: sessionStore.isRollExhausted }"
        >
          <span class="led-dot"></span>
          <span>{{ shotBadgeText }}</span>
        </RouterLink>

        <nav class="guest-nav" aria-label="Navigation">
          <RouterLink
            to="/"
            class="nav-item"
            :class="{ active: route.path === '/' }"
            title="Home"
          >
            <Home :size="17" />
            <span class="nav-label">Home</span>
          </RouterLink>

          <RouterLink
            v-if="sessionStore.hasActiveGuestSession"
            to="/camera"
            class="nav-item"
            :class="{ active: route.path === '/camera' }"
            title="Camera"
          >
            <Camera :size="17" />
            <span class="nav-label">Camera</span>
          </RouterLink>

          <RouterLink
            v-if="sessionStore.hasActiveGuestSession"
            to="/my-photos"
            class="nav-item"
            :class="{ active: route.path === '/my-photos' }"
            title="My Photos"
          >
            <Film :size="17" />
            <span class="nav-label">Photos ({{ sessionStore.usedShots }})</span>
          </RouterLink>

          <RouterLink
            to="/admin"
            class="nav-item"
            :class="{ active: route.path.startsWith('/admin') }"
            title="Admin"
          >
            <ShieldCheck :size="16" />
            <span class="nav-label">Admin</span>
          </RouterLink>
        </nav>
      </div>
    </div>
  </header>
</template>

<style scoped lang="scss">
.guest-header {
  position: sticky;
  top: 0;
  z-index: 100;
  background: rgba(245, 240, 230, 0.95);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  border-bottom: 1.5px solid var(--charcoal-border);
}

.header-inner {
  max-width: 980px;
  margin: 0 auto;
  padding: 0.55rem 0.85rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.brand-link {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  flex-shrink: 0;
}

.brand-film-tag {
  background: var(--xmas-red);
  color: var(--bg-cream);
  font-family: var(--font-mono);
  font-size: 0.65rem;
  font-weight: 700;
  padding: 0.2rem 0.4rem;
  border-radius: 5px;
}

.brand-title {
  font-family: var(--font-display);
  font-size: 1.1rem;
  font-weight: 800;
  color: var(--forest-green);
  letter-spacing: -0.02em;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.shot-counter-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  background: var(--charcoal);
  color: #f4d290;
  font-family: var(--font-mono);
  font-size: 0.68rem;
  font-weight: 700;
  padding: 0.3rem 0.55rem;
  border-radius: var(--radius-pill);

  .led-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #4ade80;
    box-shadow: 0 0 5px #4ade80;
  }

  &.exhausted {
    color: #fca5a5;
    .led-dot {
      background: var(--xmas-red-light);
    }
  }
}

.guest-nav {
  display: flex;
  align-items: center;
  gap: 0.2rem;
}

.nav-item {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  min-height: 36px;
  padding: 0.38rem 0.6rem;
  border-radius: var(--radius-pill);
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--charcoal-soft);

  &.active {
    background: var(--forest-green);
    color: var(--bg-cream);
  }
}

@media (max-width: 640px) {
  .nav-label {
    display: none;
  }

  .nav-item {
    min-width: 36px;
    padding: 0.42rem;
  }
}
</style>
