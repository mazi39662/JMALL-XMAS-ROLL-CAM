<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  ArrowRight,
  Calendar,
  Camera,
  CheckCircle2,
  Film,
  MapPin
} from 'lucide-vue-next'
import GuestHeader from '@/components/GuestHeader.vue'
import { useSessionStore } from '@/stores/sessionStore'

const sessionStore = useSessionStore()
const router = useRouter()

onMounted(async () => {
  if (!sessionStore.isHydrated) {
    await sessionStore.hydrateGuestSession()
  } else {
    await sessionStore.refreshEventSettings()
  }
})

const formattedEventDate = computed(() => {
  const raw = sessionStore.event.date
  if (!raw) return 'Dec 19, 2026 · 7:00 PM'
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return raw
  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
})

function handlePrimaryCta() {
  if (sessionStore.hasActiveGuestSession) {
    router.push('/camera')
  } else {
    router.push('/register')
  }
}
</script>

<template>
  <div class="landing-page">
    <GuestHeader />
    <div class="film-sprocket-bar" aria-hidden="true"></div>

    <main class="landing-main">
      <!-- HERO SECTION -->
      <section class="hero-section">
        <div class="hero-copy">
          <div class="edition-badges">
            <span class="badge badge-red">CHRISTMAS PARTY 2026</span>
            <span class="badge badge-gold">10 SHOTS PER GUEST</span>
          </div>

          <h1 class="hero-title">XMAS ROLL</h1>
          <p class="hero-tagline">“One night. One camera. A thousand memories.”</p>

          <!-- Compact Date & Venue Card -->
          <div class="event-meta-card retro-card">
            <div class="meta-item">
              <Calendar :size="17" class="meta-icon" />
              <span>{{ formattedEventDate }}</span>
            </div>
            <div class="meta-divider"></div>
            <div class="meta-item">
              <MapPin :size="17" class="meta-icon" />
              <span>{{ sessionStore.event.venue || 'JMall Parking Lot RoofTop' }}</span>
            </div>
          </div>

          <!-- Active Session Return Box OR Register CTA -->
          <div v-if="sessionStore.hasActiveGuestSession" class="active-session-box retro-card">
            <div class="session-box-header">
              <span class="badge badge-green">
                <CheckCircle2 :size="13" />
                {{ sessionStore.guest?.fullName }}
              </span>
              <span class="font-mono session-shots">
                {{ sessionStore.remainingShots }} / {{ sessionStore.totalShots }} SHOTS LEFT
              </span>
            </div>

            <div class="cta-stack">
              <button class="btn btn-red btn-block" @click="router.push('/camera')">
                <Camera :size="19" />
                <span>Open Camera</span>
                <ArrowRight :size="17" />
              </button>
              <button class="btn btn-outline btn-block" @click="router.push('/my-photos')">
                <Film :size="18" />
                <span>My Photos ({{ sessionStore.usedShots }})</span>
              </button>
            </div>
          </div>

          <div v-else class="cta-stack">
            <button
              class="btn btn-red btn-block"
              :disabled="!sessionStore.event.registrationOpen"
              @click="handlePrimaryCta"
            >
              <Camera :size="20" />
              <span>
                {{
                  sessionStore.event.registrationOpen
                    ? 'Register & Get Your 10 Shots'
                    : 'Registration Closed'
                }}
              </span>
              <ArrowRight :size="18" />
            </button>

            <RouterLink to="/register?mode=recover" class="btn btn-outline btn-block">
              <span>Already Registered? Open My Camera</span>
            </RouterLink>
          </div>
        </div>

        <!-- 35MM DISPOSABLE CAMERA ILLUSTRATION -->
        <div class="hero-visual">
          <div class="camera-artifact" aria-label="XMAS ROLL Disposable Camera">
            <div class="cam-top-controls">
              <div class="cam-wheel"></div>
              <div class="cam-shutter-cap"></div>
            </div>

            <div class="cam-shell">
              <div class="cam-grip-left">
                <span class="grip-brand">JMALL '26</span>
              </div>

              <div class="cam-center-wrap">
                <div class="wrap-stripe red"></div>
                <div class="wrap-stripe gold"></div>

                <div class="cam-upper-deck">
                  <div class="cam-flash-unit">
                    <div class="flash-rib"></div>
                    <span class="flash-label">FLASH</span>
                  </div>

                  <div class="cam-viewfinder-window">
                    <div class="vf-crosshair"></div>
                  </div>

                  <div class="cam-lcd-counter">
                    <span class="lcd-label">SHOTS</span>
                    <span class="lcd-digits">
                      {{ sessionStore.hasActiveGuestSession ? sessionStore.remainingShots : 10 }}
                    </span>
                  </div>
                </div>

                <div class="cam-lens-assembly">
                  <div class="lens-outer-ring">
                    <div class="lens-gold-ring">
                      <div class="lens-glass">
                        <div class="lens-reflection"></div>
                      </div>
                    </div>
                  </div>
                  <div class="lens-spec font-mono">35MM FILM CAMERA</div>
                </div>

                <div class="cam-badge-footer">
                  <span class="cam-product-title">XMAS ROLL</span>
                  <span class="cam-product-tag">10 SHOTS</span>
                </div>
              </div>

              <div class="cam-grip-right"></div>
            </div>
          </div>
        </div>
      </section>

      <!-- SIMPLE 3-STEP GUIDE -->
      <section class="steps-section">
        <div class="steps-grid">
          <div class="step-card retro-card">
            <span class="step-badge font-mono">STEP 1</span>
            <h3>Register Name</h3>
            <p>Quick sign-up. No password or app download needed.</p>
          </div>

          <div class="step-card retro-card">
            <span class="step-badge font-mono">STEP 2</span>
            <h3>Take 10 Shots</h3>
            <p>Snap retro film photos with flash and date stamps.</p>
          </div>

          <div class="step-card retro-card">
            <span class="step-badge font-mono">STEP 3</span>
            <h3>Party Slideshow</h3>
            <p>All photos go straight to tonight’s party gallery.</p>
          </div>
        </div>
      </section>
    </main>

    <footer class="landing-footer">
      <div class="film-sprocket-bar" aria-hidden="true"></div>
      <div class="footer-content font-mono">
        <span>{{ sessionStore.event.name }} · {{ sessionStore.event.venue }}</span>
        <RouterLink to="/admin">Organizer Login</RouterLink>
      </div>
    </footer>
  </div>
</template>

<style scoped lang="scss">
.landing-page {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
}

.landing-main {
  flex: 1;
  max-width: 960px;
  width: 100%;
  margin: 0 auto;
  padding: 1.25rem 1rem 2.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.75rem;
}

.hero-section {
  display: grid;
  grid-template-columns: 1.1fr 0.9fr;
  gap: 2rem;
  align-items: center;
}

.edition-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-bottom: 0.65rem;
}

.hero-title {
  font-size: clamp(2.25rem, 6vw, 3.6rem);
  color: var(--forest-green);
  line-height: 1.05;
  margin-bottom: 0.35rem;
}

.hero-tagline {
  font-family: var(--font-display);
  font-size: 1.08rem;
  font-style: italic;
  color: var(--charcoal-soft);
  margin-bottom: 1rem;
}

.event-meta-card {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  padding: 0.8rem 1rem;
  margin-bottom: 1.15rem;
  background: rgba(250, 247, 240, 0.92);
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 700;
  font-size: 0.88rem;
  color: var(--forest-green);

  .meta-icon {
    color: var(--xmas-red);
    flex-shrink: 0;
  }
}

.meta-divider {
  width: 1px;
  height: 22px;
  background: var(--charcoal-border);
}

.active-session-box {
  padding: 1rem;
  background: linear-gradient(135deg, #faf7f0 0%, #f1eadc 100%);
}

.session-box-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 0.85rem;
}

.session-shots {
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--xmas-red);
}

.cta-stack {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.btn-block {
  width: 100%;
  min-height: 50px;
  font-size: 1rem;
}

/* CAMERA ARTWORK */
.hero-visual {
  display: flex;
  justify-content: center;
}

.camera-artifact {
  width: 100%;
  max-width: 340px;
  -webkit-user-select: none;
  user-select: none;
}

.cam-top-controls {
  display: flex;
  justify-content: space-between;
  padding: 0 32px;
  margin-bottom: -4px;
}

.cam-wheel {
  width: 50px;
  height: 10px;
  background: repeating-linear-gradient(
    90deg,
    #2f3230 0px,
    #2f3230 3px,
    #181a19 3px,
    #181a19 6px
  );
  border-radius: 4px 4px 0 0;
}

.cam-shutter-cap {
  width: 46px;
  height: 13px;
  background: linear-gradient(90deg, #982c27, #cf4e48, #982c27);
  border-radius: 6px 6px 0 0;
}

.cam-shell {
  display: grid;
  grid-template-columns: 36px 1fr 36px;
  height: 215px;
  background: var(--cam-body-outer);
  border-radius: 22px;
  box-shadow: var(--shadow-camera);
  overflow: hidden;
  border: 2px solid #2e3230;
}

.cam-grip-left,
.cam-grip-right {
  background: radial-gradient(#323634 1.25px, #1b1d1c 1.25px);
  background-size: 6px 6px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.grip-brand {
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  font-family: var(--font-mono);
  font-size: 0.6rem;
  letter-spacing: 0.16em;
  color: rgba(199, 166, 106, 0.55);
}

.cam-center-wrap {
  background: var(--forest-green);
  position: relative;
  padding: 13px 15px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  border-left: 2px solid rgba(199, 166, 106, 0.35);
  border-right: 2px solid rgba(199, 166, 106, 0.35);
}

.wrap-stripe {
  position: absolute;
  left: 0;
  right: 0;
  height: 5px;
  pointer-events: none;

  &.red {
    top: 56px;
    background: var(--xmas-red);
  }
  &.gold {
    top: 61px;
    background: var(--muted-gold);
    height: 3px;
  }
}

.cam-upper-deck {
  display: flex;
  align-items: center;
  justify-content: space-between;
  z-index: 2;
}

.cam-flash-unit {
  width: 70px;
  height: 32px;
  background: linear-gradient(135deg, #e8edf2 0%, #b8c4ce 50%, #dce4ec 100%);
  border-radius: 6px;
  border: 2px solid #232625;
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: 2px;

  .flash-rib {
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(
      90deg,
      rgba(255, 255, 255, 0.5) 0px,
      rgba(255, 255, 255, 0.5) 3px,
      rgba(0, 0, 0, 0.08) 3px,
      rgba(0, 0, 0, 0.08) 6px
    );
  }

  .flash-label {
    position: relative;
    font-family: var(--font-mono);
    font-size: 0.48rem;
    font-weight: 700;
    color: #1f2421;
    background: rgba(255, 255, 255, 0.8);
    padding: 0 4px;
    border-radius: 2px;
  }
}

.cam-viewfinder-window {
  width: 38px;
  height: 28px;
  background: radial-gradient(circle at 30% 30%, #3a4f49, #0e1714);
  border: 2px solid #252826;
  border-radius: 5px;
  display: flex;
  align-items: center;
  justify-content: center;

  .vf-crosshair {
    width: 14px;
    height: 10px;
    border: 1px solid rgba(255, 230, 170, 0.5);
  }
}

.cam-lcd-counter {
  background: var(--cam-lcd-bg);
  border: 2px solid #232625;
  border-radius: 5px;
  padding: 2px 7px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;

  .lcd-label {
    font-family: var(--font-mono);
    font-size: 0.44rem;
    color: var(--cam-lcd-text);
    line-height: 1;
  }

  .lcd-digits {
    font-family: var(--font-mono);
    font-size: 0.88rem;
    font-weight: 700;
    color: var(--cam-lcd-text);
    line-height: 1.05;
  }
}

.cam-lens-assembly {
  display: flex;
  flex-direction: column;
  align-items: center;
  z-index: 2;
}

.lens-outer-ring {
  width: 88px;
  height: 88px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #383c3a, #141615);
  border: 3px solid #2b2f2d;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.45);
}

.lens-gold-ring {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  border: 2px solid var(--muted-gold);
  background: #101211;
  display: flex;
  align-items: center;
  justify-content: center;
}

.lens-glass {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 35%, #2e594d 0%, #12211d 55%, #070b09 100%);
  position: relative;

  .lens-reflection {
    position: absolute;
    top: 7px;
    left: 8px;
    width: 10px;
    height: 6px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.35);
    transform: rotate(-28deg);
  }
}

.lens-spec {
  font-size: 0.54rem;
  color: rgba(245, 240, 230, 0.75);
  margin-top: 4px;
}

.cam-badge-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid rgba(199, 166, 106, 0.25);
  padding-top: 4px;

  .cam-product-title {
    font-family: var(--font-display);
    font-size: 0.8rem;
    font-weight: 800;
    color: var(--bg-cream);
  }

  .cam-product-tag {
    font-family: var(--font-mono);
    font-size: 0.52rem;
    background: var(--muted-gold);
    color: var(--charcoal);
    padding: 1px 5px;
    border-radius: 3px;
    font-weight: 700;
  }
}

/* SIMPLE 3-STEP CARDS */
.steps-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.85rem;
}

.step-card {
  padding: 1rem 1.1rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;

  .step-badge {
    font-size: 0.65rem;
    font-weight: 700;
    color: var(--xmas-red);
    letter-spacing: 0.06em;
  }

  h3 {
    font-size: 1.02rem;
    color: var(--forest-green);
  }

  p {
    font-size: 0.84rem;
    color: var(--charcoal-soft);
  }
}

.landing-footer {
  background: var(--forest-green-dark);
  color: var(--bg-cream);
}

.footer-content {
  max-width: 960px;
  margin: 0 auto;
  padding: 0.9rem 1rem;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.72rem;

  a {
    color: var(--muted-gold-light);
    text-decoration: underline;
  }
}

@media (max-width: 768px) {
  .hero-section {
    grid-template-columns: 1fr;
    gap: 1.35rem;
  }

  .event-meta-card {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }

  .meta-divider {
    display: none;
  }

  .steps-grid {
    grid-template-columns: 1fr;
  }
}
</style>
