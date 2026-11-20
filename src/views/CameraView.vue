<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  AlertTriangle,
  Camera,
  Check,
  Film,
  Layers,
  RefreshCw,
  RotateCcw,
  Sparkles,
  SwitchCamera,
  Zap,
  ZapOff
} from 'lucide-vue-next'
import GuestHeader from '@/components/GuestHeader.vue'
import { useDisposableCamera } from '@/composables/useDisposableCamera'
import {
  FILM_FILTER_OPTIONS,
  FILM_OVERLAY_OPTIONS,
  reprocessCapturedFrame,
  type ProcessedFilmFrame
} from '@/services/filmProcessor'
import { useSessionStore } from '@/stores/sessionStore'
import type { FilmFilterPreset, FilmOverlayPreset } from '@/types'

const sessionStore = useSessionStore()
const router = useRouter()

const {
  videoRef,
  fallbackCanvasRef,
  permissionStatus,
  facingMode,
  flashEnabled,
  isShutterFiring,
  isFlashBursting,
  isSwitchingCamera,
  filmConfig,
  startCamera,
  startSimulatedViewfinder,
  switchCameraFacing,
  toggleFlash,
  captureFrame
} = useDisposableCamera()

const pendingCapture = ref<ProcessedFilmFrame | null>(null)
const pendingCapturedAt = ref<string>('')
const previewMode = ref<'processed' | 'original'>('processed')
const isUploading = ref(false)
const isReprocessing = ref(false)
const uploadError = ref('')
const justUploadedBanner = ref('')
const retryingPendingId = ref<string | null>(null)

const shotCounterDisplay = computed(() => {
  return `${sessionStore.remainingShots} / ${sessionStore.totalShots} SHOTS`
})

const nextShotNumber = computed(() => {
  return Math.min(sessionStore.totalShots, sessionStore.usedShots + 1)
})

const activeOverlay = computed<FilmOverlayPreset>(() => {
  return filmConfig.value.overlayPreset || '35mm-film'
})

const isCameraOperational = computed(() => {
  return (
    sessionStore.event.cameraEnabled &&
    sessionStore.event.photoSubmissionOpen &&
    !sessionStore.isRollExhausted
  )
})

const isShutterDisabled = computed(() => {
  return (
    !isCameraOperational.value ||
    isShutterFiring.value ||
    isUploading.value ||
    Boolean(pendingCapture.value)
  )
})

onMounted(async () => {
  const hasSession = await sessionStore.hydrateGuestSession()
  if (!hasSession) {
    router.replace('/register')
    return
  }
  await startCamera('environment')
})

async function selectFilter(filterId: FilmFilterPreset) {
  filmConfig.value.warmthPreset = filterId
  await updatePendingPreviewIfOpen()
}

async function selectOverlay(overlayId: FilmOverlayPreset) {
  filmConfig.value.overlayPreset = overlayId
  filmConfig.value.filmFrameOverlay = overlayId !== 'none'
  await updatePendingPreviewIfOpen()
}

async function updatePendingPreviewIfOpen() {
  if (!pendingCapture.value?.sourceCanvas || isReprocessing.value) return
  isReprocessing.value = true
  try {
    const current = pendingCapture.value
    pendingCapture.value = await reprocessCapturedFrame(
      current.sourceCanvas!,
      current.rawOriginalBlob || current.originalBlob,
      current.originalPreviewDataUrl,
      filmConfig.value,
      nextShotNumber.value,
      pendingCapturedAt.value || new Date().toISOString()
    )
    previewMode.value = 'processed'
  } finally {
    isReprocessing.value = false
  }
}

async function handleShutterPress() {
  if (isShutterDisabled.value) return
  uploadError.value = ''
  justUploadedBanner.value = ''

  try {
    const capturedIso = new Date().toISOString()
    const frame = await captureFrame(nextShotNumber.value)
    pendingCapturedAt.value = capturedIso
    previewMode.value = 'processed'
    pendingCapture.value = frame
  } catch (err: any) {
    uploadError.value = err?.message || 'Could not capture photo.'
  }
}

async function handleRetake() {
  if (isUploading.value) return
  // If a previous save attempt failed and left a pending item for this shot, remove it when retaking
  if (sessionStore.cameraSession) {
    const candidateId = `${sessionStore.cameraSession.id}_shot_${nextShotNumber.value}`
    const hasPending = sessionStore.pendingUploads.some(
      (p) => p.photoId === candidateId || p.id === candidateId
    )
    if (hasPending) {
      await sessionStore.discardFailedPhotoUpload(candidateId).catch(() => {})
    }
  }
  pendingCapture.value = null
  pendingCapturedAt.value = ''
  uploadError.value = ''
}

async function handleConfirmAndDevelop() {
  if (!pendingCapture.value || isUploading.value) return
  isUploading.value = true
  uploadError.value = ''

  try {
    const capture = pendingCapture.value
    const savedPhoto = await sessionStore.uploadAndConsumeShot({
      processedBlob: capture.processedBlob,
      originalBlob: capture.originalBlob,
      capturedAt: pendingCapturedAt.value || new Date().toISOString(),
      flashUsed: flashEnabled.value,
      facingMode: facingMode.value,
      preset: filmConfig.value.warmthPreset,
      overlay: activeOverlay.value,
      width: capture.width,
      height: capture.height
    })

    pendingCapture.value = null
    pendingCapturedAt.value = ''
    justUploadedBanner.value = `Photo #${savedPhoto.shotNumber} saved! HD original stored on device · ${sessionStore.remainingShots} shots left`

    setTimeout(() => {
      justUploadedBanner.value = ''
    }, 3600)
  } catch (err: any) {
    uploadError.value =
      err?.message || 'Upload failed. Shot was not used—please try again.'
  } finally {
    isUploading.value = false
  }
}

async function handleRetryInterruptedUpload(photoId: string) {
  if (isUploading.value || retryingPendingId.value) return
  retryingPendingId.value = photoId
  uploadError.value = ''
  try {
    const savedPhoto = await sessionStore.retryFailedPhotoUpload(photoId)
    justUploadedBanner.value = `Recovered Photo #${savedPhoto.shotNumber} uploaded! (${sessionStore.remainingShots} left)`
    setTimeout(() => {
      justUploadedBanner.value = ''
    }, 3600)
  } catch (err: any) {
    uploadError.value = err?.message || 'Could not retry photo upload. Shot was not consumed.'
  } finally {
    retryingPendingId.value = null
  }
}

async function handleDiscardInterruptedUpload(photoId: string) {
  if (retryingPendingId.value) return
  await sessionStore.discardFailedPhotoUpload(photoId)
}
</script>

<template>
  <div class="camera-screen">
    <GuestHeader />

    <!-- WHITE SCREEN FLASH OVERLAY -->
    <Transition name="flash-fade">
      <div v-if="isFlashBursting" class="xenon-flash-overlay" aria-hidden="true"></div>
    </Transition>

    <main class="camera-stage">
      <section class="disposable-camera-body" aria-label="Disposable Camera">
        <!-- TOP BAR: Flash Status | Shot Counter | My Photos -->
        <div class="cam-top-deck">
          <div class="flash-indicator">
            <span class="cap-dot" :class="{ active: flashEnabled }"></span>
            <span class="cap-text font-mono">
              {{ flashEnabled ? 'FLASH' : 'NO FLASH' }}
            </span>
          </div>

          <div
            class="lcd-shot-window"
            :class="{ empty: sessionStore.isRollExhausted }"
            data-testid="shot-counter"
          >
            <span class="lcd-counter-text font-mono">{{ shotCounterDisplay }}</span>
          </div>

          <RouterLink to="/my-photos" class="roll-strip-btn font-mono">
            <Film :size="14" />
            <span>{{ sessionStore.usedShots }}</span>
          </RouterLink>
        </div>

        <!-- VIEWFINDER WITH LIVE FILTER & OVERLAY PREVIEW -->
        <div class="viewfinder-bezel">
          <div class="viewfinder-viewport" :class="{ shuttering: isShutterFiring }">
            <video
              v-show="permissionStatus === 'granted'"
              ref="videoRef"
              class="viewfinder-video"
              :class="[
                `preset-${filmConfig.warmthPreset}`,
                { mirrored: facingMode === 'user' }
              ]"
              playsinline
              autoplay
              muted
            ></video>

            <canvas
              v-show="permissionStatus !== 'granted'"
              ref="fallbackCanvasRef"
              width="640"
              height="960"
              class="viewfinder-canvas"
              :class="[`preset-${filmConfig.warmthPreset}`]"
            ></canvas>

            <div class="vf-grain-overlay" aria-hidden="true"></div>
            <div class="vf-vignette-overlay" aria-hidden="true"></div>

            <!-- ===============================================================
                 LIVE OVERLAY PREVIEW LAYERS IN VIEWFINDER
                 =============================================================== -->
            <!-- 1. 35MM FILM STRIP OVERLAY -->
            <div
              v-if="activeOverlay === '35mm-film'"
              class="live-overlay overlay-35mm font-mono"
              aria-hidden="true"
            >
              <div class="strip-edge top">
                <span>KODAK / XMAS ROLL</span>
                <span>▶ {{ nextShotNumber }}A</span>
                <span>JMALL 2026</span>
              </div>
              <div class="strip-edge bottom">
                <span>◀ {{ nextShotNumber }}</span>
                <span>ROOFTOP PARTY</span>
              </div>
            </div>

            <!-- 2. POLAROID INSTANT FRAME OVERLAY -->
            <div
              v-else-if="activeOverlay === 'polaroid'"
              class="live-overlay overlay-polaroid"
              aria-hidden="true"
            >
              <div class="polaroid-caption">
                <strong>JMall Christmas Party ’26</strong>
                <span class="font-mono">SHOT #0{{ nextShotNumber }} · PARKING LOT ROOFTOP</span>
              </div>
            </div>

            <!-- 3. VINTAGE LIGHT LEAK OVERLAY -->
            <div
              v-else-if="activeOverlay === 'light-leak'"
              class="live-overlay overlay-light-leak"
              aria-hidden="true"
            ></div>

            <!-- 4. XMAS PARTY STAMP OVERLAY (Candy-Cane Border, Garland, String Lights, Bells, Snowflakes, Trees & Gifts) -->
            <div
              v-else-if="activeOverlay === 'xmas-stamp'"
              class="live-overlay overlay-xmas-stamp font-mono"
              aria-hidden="true"
            >
              <!-- Top Evergreen Garland & Glowing Fairy Lights -->
              <div class="xmas-garland-bar">
                <div class="swag-arch"></div>
                <div class="swag-arch"></div>
                <div class="swag-arch"></div>
                <div class="swag-arch"></div>
              </div>

              <div class="fairy-lights-row">
                <span class="bulb red"></span>
                <span class="bulb gold"></span>
                <span class="bulb green"></span>
                <span class="bulb red"></span>
                <span class="bulb gold"></span>
              </div>

              <!-- Hanging Ornaments, Bells & Banner -->
              <div class="xmas-top-decor">
                <span class="bell-corner left">🔔</span>
                <span class="bauble red b1"></span>
                <div class="xmas-pill">🎄 MERRY CHRISTMAS · JMALL ’26 🔔</div>
                <span class="bauble gold b2"></span>
                <span class="bell-corner right">🔔</span>
              </div>

              <!-- Snowflakes & Stars -->
              <span class="xmas-flake f1">❄</span>
              <span class="xmas-flake f2">❄</span>
              <span class="xmas-flake f3">❄</span>
              <span class="xmas-flake f4">❄</span>
              <span class="xmas-star s1">✦</span>
              <span class="xmas-star s2">✦</span>

              <!-- Bottom Snow Drift, Forest Trees & Gift Boxes -->
              <div class="xmas-bottom-scene">
                <div class="snow-drift"></div>
                <div class="xmas-bottom-trees">
                  <div class="tree-cluster">
                    <svg class="corner-tree main" viewBox="0 0 64 84" aria-hidden="true">
                      <rect x="26" y="70" width="12" height="12" fill="#5C3A21" />
                      <polygon points="32,32 8,70 56,70" fill="#183D32" stroke="#DFC492" stroke-width="1.6" />
                      <polygon points="32,18 13,52 51,52" fill="#183D32" stroke="#DFC492" stroke-width="1.6" />
                      <polygon points="32,6 18,34 46,34" fill="#183D32" stroke="#DFC492" stroke-width="1.6" />
                      <circle cx="32" cy="5" r="4.2" fill="#FFD54F" />
                      <circle cx="24" cy="44" r="3" fill="#E53935" />
                      <circle cx="39" cy="48" r="3" fill="#FFD54F" />
                      <circle cx="32" cy="56" r="2.8" fill="#69F0AE" />
                      <circle cx="22" cy="62" r="3" fill="#FFD54F" />
                      <circle cx="42" cy="63" r="3" fill="#E53935" />
                      <circle cx="32" cy="27" r="2.8" fill="#E53935" />
                    </svg>
                    <span class="gift-icon">🎁</span>
                  </div>

                  <div class="tree-cluster right-side">
                    <span class="gift-icon">🎁</span>
                    <svg class="corner-tree main" viewBox="0 0 64 84" aria-hidden="true">
                      <rect x="26" y="70" width="12" height="12" fill="#5C3A21" />
                      <polygon points="32,32 8,70 56,70" fill="#183D32" stroke="#DFC492" stroke-width="1.6" />
                      <polygon points="32,18 13,52 51,52" fill="#183D32" stroke="#DFC492" stroke-width="1.6" />
                      <polygon points="32,6 18,34 46,34" fill="#183D32" stroke="#DFC492" stroke-width="1.6" />
                      <circle cx="32" cy="5" r="4.2" fill="#FFD54F" />
                      <circle cx="25" cy="46" r="3" fill="#FFD54F" />
                      <circle cx="38" cy="44" r="3" fill="#E53935" />
                      <circle cx="23" cy="63" r="3" fill="#E53935" />
                      <circle cx="40" cy="61" r="3" fill="#FFD54F" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>

            <!-- QUARTZ DATE STAMP -->
            <span
              class="live-quartz-stamp font-mono"
              :class="{ 'above-polaroid': activeOverlay === 'polaroid' }"
              aria-hidden="true"
            >
              '26 12 19
            </span>

            <!-- Camera Permission Denied Overlay -->
            <div v-if="permissionStatus === 'denied'" class="permission-overlay">
              <AlertTriangle :size="26" />
              <h3>Allow Camera Access</h3>
              <p>Please allow camera access in your browser to take photos.</p>
              <div class="perm-actions">
                <button type="button" class="btn btn-gold" @click="startCamera(facingMode)">
                  <RefreshCw :size="16" />
                  <span>Try Again</span>
                </button>
                <button
                  type="button"
                  class="btn btn-outline perm-sim-btn"
                  @click="startSimulatedViewfinder()"
                >
                  <Sparkles :size="16" />
                  <span>Demo Viewfinder</span>
                </button>
              </div>
            </div>

            <!-- Roll Finished (0 / 10 SHOTS) Overlay -->
            <div v-if="sessionStore.isRollExhausted" class="roll-finished-overlay">
              <div class="finished-badge font-mono">0 / 10 SHOTS LEFT</div>
              <h3>All 10 Shots Used!</h3>
              <p>Your photos are saved in the party gallery.</p>
              <RouterLink to="/my-photos" class="btn btn-gold">
                <Film :size="18" />
                <span>View My 10 Photos</span>
              </RouterLink>
            </div>

            <!-- Camera Paused Overlay -->
            <div
              v-else-if="!sessionStore.event.cameraEnabled || !sessionStore.event.photoSubmissionOpen"
              class="roll-finished-overlay"
            >
              <AlertTriangle :size="26" />
              <h3>Camera Paused</h3>
              <p>Photo submissions are currently closed.</p>
              <RouterLink to="/my-photos" class="btn btn-gold">
                <Film :size="18" />
                <span>View My Photos</span>
              </RouterLink>
            </div>
          </div>
        </div>

        <!-- ===================================================================
             SWIPEABLE FILTERS & OVERLAYS SELECTOR DECK
             =================================================================== -->
        <div class="effects-selector-deck">
          <!-- Row 1: Film Color Filters -->
          <div class="selector-row">
            <span class="row-label font-mono">
              <Sparkles :size="11" />
              FILTER
            </span>
            <div class="scroll-pills" role="group" aria-label="Camera Filters">
              <button
                v-for="f in FILM_FILTER_OPTIONS"
                :key="f.id"
                type="button"
                class="preset-chip font-mono"
                :class="{ active: filmConfig.warmthPreset === f.id }"
                @click="selectFilter(f.id)"
              >
                {{ f.label }}
              </button>
            </div>
          </div>

          <!-- Row 2: Frame Overlays -->
          <div class="selector-row">
            <span class="row-label font-mono">
              <Layers :size="11" />
              FRAME
            </span>
            <div class="scroll-pills" role="group" aria-label="Camera Overlays">
              <button
                v-for="ov in FILM_OVERLAY_OPTIONS"
                :key="ov.id"
                type="button"
                class="preset-chip overlay-chip font-mono"
                :class="{ active: activeOverlay === ov.id }"
                @click="selectOverlay(ov.id)"
              >
                {{ ov.label }}
              </button>
            </div>
          </div>
        </div>

        <!-- SHUTTER CONTROLS: Flash | Big Shutter Button | Flip Camera -->
        <div class="shutter-control-deck">
          <button
            type="button"
            class="deck-side-btn"
            :class="{ active: flashEnabled }"
            :disabled="sessionStore.isRollExhausted"
            aria-label="Toggle Flash"
            data-testid="flash-toggle-btn"
            @click="toggleFlash"
          >
            <Zap v-if="flashEnabled" :size="20" />
            <ZapOff v-else :size="20" />
            <span class="side-btn-label font-mono">
              {{ flashEnabled ? 'FLASH ON' : 'FLASH OFF' }}
            </span>
          </button>

          <div class="shutter-housing">
            <button
              type="button"
              class="shutter-release-btn"
              :disabled="isShutterDisabled"
              aria-label="Take Photo"
              data-testid="shutter-btn"
              @click="handleShutterPress"
            >
              <span class="shutter-inner-ring">
                <Camera :size="26" />
              </span>
            </button>
          </div>

          <button
            type="button"
            class="deck-side-btn"
            :disabled="isSwitchingCamera || sessionStore.isRollExhausted"
            aria-label="Switch Camera"
            data-testid="switch-camera-btn"
            @click="switchCameraFacing"
          >
            <SwitchCamera :size="20" />
            <span class="side-btn-label font-mono">FLIP</span>
          </button>
        </div>

        <Transition name="fade">
          <div v-if="justUploadedBanner" class="developed-toast font-mono" role="status">
            <Check :size="15" />
            <span>{{ justUploadedBanner }}</span>
          </div>
        </Transition>

        <!-- PENDING / INTERRUPTED UPLOAD RECOVERY BAR -->
        <div
          v-if="!pendingCapture && sessionStore.pendingUploads.length > 0 && !sessionStore.isRollExhausted"
          class="pending-recovery-bar"
          role="region"
          aria-label="Pending Photo Upload Recovery"
        >
          <div class="pending-recovery-info">
            <AlertTriangle :size="15" class="warn-icon" />
            <span>
              <strong>{{ sessionStore.pendingUploads.length }} unsent HD photo(s)</strong> saved on
              your device from an interrupted upload.
            </span>
          </div>
          <div class="pending-recovery-actions">
            <button
              type="button"
              class="btn btn-gold btn-xs"
              :disabled="Boolean(retryingPendingId)"
              data-testid="retry-pending-camera-btn"
              @click="handleRetryInterruptedUpload(sessionStore.pendingUploads[0]!.photoId)"
            >
              <RefreshCw :size="13" />
              <span>
                {{
                  retryingPendingId === sessionStore.pendingUploads[0]!.photoId
                    ? 'Retrying...'
                    : 'Retry Upload'
                }}
              </span>
            </button>
            <button
              type="button"
              class="btn btn-outline btn-xs discard-pending-btn"
              :disabled="Boolean(retryingPendingId)"
              @click="handleDiscardInterruptedUpload(sessionStore.pendingUploads[0]!.photoId)"
            >
              <span>Discard</span>
            </button>
          </div>
        </div>
      </section>
    </main>

    <!-- =======================================================================
         CAPTURED PHOTO CONFIRMATION MODAL (Save Photo or Take Shot Again!)
         ======================================================================= -->
    <Transition name="fade">
      <div
        v-if="pendingCapture"
        class="capture-preview-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Confirm Captured Photo"
        data-testid="capture-confirm-modal"
      >
        <div class="preview-card retro-card">
          <div class="preview-header">
            <div>
              <h2>Confirm Shot #{{ nextShotNumber }}?</h2>
              <p class="confirm-subtitle font-mono">
                Save this photo to your roll or take the shot again
              </p>
            </div>
            <div class="preview-tabs">
              <button
                type="button"
                class="preview-tab font-mono"
                :class="{ active: previewMode === 'processed' }"
                @click="previewMode = 'processed'"
              >
                With Effects
              </button>
              <button
                type="button"
                class="preview-tab font-mono"
                :class="{ active: previewMode === 'original' }"
                @click="previewMode = 'original'"
              >
                Original
              </button>
            </div>
          </div>

          <div class="preview-image-frame">
            <img
              :src="
                previewMode === 'processed'
                  ? pendingCapture.previewDataUrl
                  : pendingCapture.originalPreviewDataUrl
              "
              alt="Captured photo preview"
              class="preview-img"
            />
          </div>

          <!-- Switch Filter or Overlay right inside Preview before sending! -->
          <div class="preview-effects-bar">
            <div class="scroll-pills">
              <button
                v-for="f in FILM_FILTER_OPTIONS"
                :key="f.id"
                type="button"
                class="preview-pill font-mono"
                :class="{ active: filmConfig.warmthPreset === f.id }"
                :disabled="isUploading"
                @click="selectFilter(f.id)"
              >
                {{ f.label }}
              </button>
            </div>
            <div class="scroll-pills">
              <button
                v-for="ov in FILM_OVERLAY_OPTIONS"
                :key="ov.id"
                type="button"
                class="preview-pill overlay font-mono"
                :class="{ active: activeOverlay === ov.id }"
                :disabled="isUploading"
                @click="selectOverlay(ov.id)"
              >
                {{ ov.label }}
              </button>
            </div>
          </div>

          <!-- Upload Progress Indicator -->
          <div v-if="isUploading && sessionStore.uploadProgress" class="upload-progress-box">
            <div class="progress-top font-mono">
              <span>{{ sessionStore.uploadProgress.label }}</span>
              <span>{{ sessionStore.uploadProgress.percent }}%</span>
            </div>
            <div class="progress-track">
              <div
                class="progress-fill"
                :style="{ width: `${sessionStore.uploadProgress.percent}%` }"
              ></div>
            </div>
          </div>

          <div v-if="uploadError" class="preview-error" role="alert">
            <AlertTriangle :size="17" />
            <span>{{ uploadError }}</span>
          </div>

          <div class="preview-actions">
            <button
              type="button"
              class="btn btn-outline retake-btn"
              :disabled="isUploading"
              data-testid="retake-btn"
              @click="handleRetake"
            >
              <RotateCcw :size="18" />
              <span>Take Shot Again</span>
            </button>

            <button
              type="button"
              class="btn btn-red upload-btn"
              :disabled="isUploading || isReprocessing"
              data-testid="confirm-upload-btn"
              @click="handleConfirmAndDevelop"
            >
              <Check :size="19" />
              <span>
                {{
                  isUploading
                    ? 'Saving & Uploading...'
                    : uploadError
                      ? 'Retry Save & Upload'
                      : 'Save Photo (Uses 1 Shot)'
                }}
              </span>
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped lang="scss">
.camera-screen {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: #121514;
  color: var(--bg-cream);
}

.xenon-flash-overlay {
  position: fixed;
  inset: 0;
  background: #ffffff;
  z-index: 9998;
  pointer-events: none;
}

.flash-fade-enter-active {
  transition: opacity 0.04s ease-out;
}
.flash-fade-leave-active {
  transition: opacity 0.32s ease-out;
}
.flash-fade-enter-from,
.flash-fade-leave-to {
  opacity: 0;
}

.camera-stage {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.35rem 0.5rem 0.65rem;
}

.disposable-camera-body {
  width: 100%;
  max-width: 420px;
  background: linear-gradient(180deg, #1d211f 0%, #151817 100%);
  border: 2px solid #2e3431;
  border-radius: 24px;
  padding: 0.55rem 0.65rem 0.75rem;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
  display: flex;
  flex-direction: column;
  gap: 0.48rem;
}

/* TOP DECK */
.cam-top-deck {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
  background: #141716;
  padding: 0.4rem 0.6rem;
  border-radius: 12px;
}

.flash-indicator {
  display: flex;
  align-items: center;
  gap: 0.35rem;

  .cap-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #4b5563;

    &.active {
      background: #ff6b2b;
      box-shadow: 0 0 8px #ff6b2b;
    }
  }

  .cap-text {
    font-size: 0.65rem;
    font-weight: 700;
    color: #d1d5db;
  }
}

.lcd-shot-window {
  background: var(--cam-lcd-bg);
  border: 2px solid #0d100e;
  border-radius: 6px;
  padding: 0.2rem 0.6rem;
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.45);

  .lcd-counter-text {
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--cam-lcd-text);
    letter-spacing: 0.05em;
  }

  &.empty {
    background: #9e7b76;
  }
}

.roll-strip-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--muted-gold-light);
  padding: 0.25rem 0.5rem;
  border-radius: 8px;
  background: rgba(199, 166, 106, 0.16);
}

/* VIEWFINDER */
.viewfinder-bezel {
  background: #0c0e0d;
  padding: 5px;
  border-radius: 16px;
  border: 1.5px solid #2b302e;
  width: 100%;
  max-width: min(100%, calc(52dvh * 2 / 3));
  margin: 0 auto;
}

.viewfinder-viewport {
  position: relative;
  width: 100%;
  aspect-ratio: 2 / 3;
  border-radius: 12px;
  overflow: hidden;
  background: #090b0a;
  transition: transform 0.12s ease;

  &.shuttering {
    transform: scale(0.985);
    filter: brightness(0.35);
  }
}

.viewfinder-video,
.viewfinder-canvas {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;

  &.mirrored {
    transform: scaleX(-1);
  }

  &.preset-kodak-gold {
    filter: sepia(0.18) saturate(1.08) contrast(1.04) brightness(1.02);
  }

  &.preset-fuji-warm {
    filter: sepia(0.1) hue-rotate(-6deg) saturate(1.06) contrast(1.03);
  }

  &.preset-holiday-velvet {
    filter: sepia(0.24) saturate(1.14) contrast(1.06);
  }

  &.preset-retro-bw {
    filter: grayscale(1) contrast(1.18) brightness(1.02);
  }

  &.preset-polaroid-fade {
    filter: sepia(0.22) contrast(0.92) brightness(1.06) saturate(0.9);
  }

  &.preset-cyber-xmas {
    filter: contrast(1.16) saturate(1.24) hue-rotate(6deg);
  }
}

.vf-grain-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0.11;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}

.vf-vignette-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(circle, transparent 54%, rgba(10, 8, 6, 0.52) 100%);
}

/* ============================================================================
   LIVE VIEWFINDER OVERLAY STYLES
   ============================================================================ */
.live-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 4;
}

.overlay-35mm {
  border-top: 16px solid #141311;
  border-bottom: 16px solid #141311;
  border-left: 10px solid #141311;
  border-right: 10px solid #141311;
  box-shadow: inset 0 0 0 1px rgba(199, 166, 106, 0.35);

  .strip-edge {
    position: absolute;
    left: 6px;
    right: 6px;
    display: flex;
    justify-content: space-between;
    font-size: 0.52rem;
    font-weight: 700;
    color: rgba(218, 168, 88, 0.85);
    line-height: 16px;

    &.top {
      top: -16px;
    }
    &.bottom {
      bottom: -16px;
    }
  }
}

.overlay-polaroid {
  border-top: 12px solid #f7f3ea;
  border-left: 12px solid #f7f3ea;
  border-right: 12px solid #f7f3ea;
  border-bottom: 48px solid #f7f3ea;

  .polaroid-caption {
    position: absolute;
    bottom: -44px;
    left: 0;
    right: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    line-height: 1.15;

    strong {
      font-family: var(--font-display);
      font-style: italic;
      font-size: 0.85rem;
      color: var(--forest-green);
    }

    span {
      font-size: 0.54rem;
      font-weight: 700;
      color: var(--xmas-red);
      margin-top: 2px;
    }
  }
}

.overlay-light-leak {
  background:
    linear-gradient(125deg, rgba(255, 72, 18, 0.5) 0%, rgba(255, 165, 45, 0.22) 32%, transparent 65%),
    radial-gradient(circle at 90% 18%, rgba(255, 210, 120, 0.45) 0%, rgba(220, 55, 45, 0.22) 35%, transparent 65%);
  border: 6px solid #141311;
}

.overlay-xmas-stamp {
  border: 10px solid transparent;
  border-image: repeating-linear-gradient(
      45deg,
      #b53b35 0px,
      #b53b35 10px,
      #f7f2e7 10px,
      #f7f2e7 18px,
      #183d32 18px,
      #183d32 26px,
      #f7f2e7 26px,
      #f7f2e7 32px
    )
    10;
  box-shadow: inset 0 0 0 2px #dfc492;
  display: flex;
  flex-direction: column;
  justify-content: space-between;

  .xmas-garland-bar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    height: 18px;
    pointer-events: none;

    .swag-arch {
      background: #183d32;
      border-bottom: 2.5px solid #245849;
      border-radius: 0 0 50% 50%;
      box-shadow: 0 2px 5px rgba(0, 0, 0, 0.35);
    }
  }

  .fairy-lights-row {
    position: absolute;
    top: 12px;
    left: 12%;
    right: 12%;
    display: flex;
    justify-content: space-between;
    z-index: 2;

    .bulb {
      width: 7px;
      height: 7px;
      border-radius: 50%;

      &.red {
        background: #ff5252;
        box-shadow: 0 0 8px #ff5252;
      }
      &.gold {
        background: #ffd740;
        box-shadow: 0 0 8px #ffd740;
      }
      &.green {
        background: #69f0ae;
        box-shadow: 0 0 8px #69f0ae;
      }
    }
  }

  .xmas-top-decor {
    position: relative;
    z-index: 3;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding: 8px 6px 0;
  }

  .bell-corner {
    font-size: 1.3rem;
    filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5));
  }

  .bauble {
    width: 13px;
    height: 13px;
    border-radius: 50%;
    border: 1.5px solid #dfc492;
    position: relative;
    margin-top: 12px;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.45);

    &::before {
      content: '';
      position: absolute;
      bottom: 100%;
      left: 50%;
      width: 1.5px;
      height: 14px;
      background: #dfc492;
      transform: translateX(-50%);
    }

    &.red {
      background: #b53b35;
    }
    &.gold {
      background: #d9a441;
    }
  }

  .xmas-pill {
    background: #b53b35;
    color: #faf7f0;
    border: 2px solid #ffe082;
    padding: 0.22rem 0.55rem;
    font-size: 0.54rem;
    font-weight: 700;
    border-radius: 5px;
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.4);
    white-space: nowrap;
  }

  .xmas-flake {
    position: absolute;
    color: rgba(255, 252, 245, 0.9);
    font-size: 0.92rem;
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);

    &.f1 {
      top: 22%;
      left: 6%;
    }
    &.f2 {
      top: 24%;
      right: 6%;
    }
    &.f3 {
      top: 52%;
      left: 5%;
    }
    &.f4 {
      top: 50%;
      right: 5%;
    }
  }

  .xmas-star {
    position: absolute;
    color: #ffe082;
    font-size: 0.85rem;
    text-shadow: 0 0 6px rgba(255, 224, 130, 0.85);

    &.s1 {
      top: 36%;
      left: 11%;
    }
    &.s2 {
      top: 38%;
      right: 11%;
    }
  }

  .xmas-bottom-scene {
    position: relative;
    width: 100%;
    padding-top: 12px;
  }

  .snow-drift {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 14px;
    background: rgba(250, 247, 240, 0.92);
    border-radius: 50% 50% 0 0 / 100% 100% 0 0;
  }

  .xmas-bottom-trees {
    position: relative;
    z-index: 2;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    padding: 0 4px;

    .tree-cluster {
      display: flex;
      align-items: flex-end;
      gap: 2px;
    }

    .corner-tree {
      width: 54px;
      height: 70px;
      filter: drop-shadow(0 3px 6px rgba(0, 0, 0, 0.45));
    }

    .gift-icon {
      font-size: 1.15rem;
      margin-bottom: 2px;
      filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.4));
    }
  }
}

.live-quartz-stamp {
  position: absolute;
  bottom: 18px;
  right: 16px;
  z-index: 5;
  pointer-events: none;
  color: #ff9838;
  text-shadow: 0 0 8px rgba(255, 94, 0, 0.85);
  font-size: 0.78rem;
  font-weight: 700;

  &.above-polaroid {
    bottom: 54px;
    right: 18px;
  }
}

.permission-overlay,
.roll-finished-overlay {
  position: absolute;
  inset: 0;
  background: rgba(16, 24, 21, 0.93);
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 0.65rem;
  z-index: 10;

  h3 {
    font-size: 1.25rem;
    color: var(--bg-cream);
  }

  p {
    font-size: 0.85rem;
    color: rgba(245, 240, 230, 0.8);
  }
}

.perm-actions {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: 100%;
  max-width: 220px;
}

.perm-sim-btn {
  color: var(--bg-cream);
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.25);
}

.finished-badge {
  background: var(--xmas-red);
  color: var(--bg-cream);
  font-size: 0.7rem;
  font-weight: 700;
  padding: 0.22rem 0.6rem;
  border-radius: var(--radius-pill);
}

/* ============================================================================
   SWIPEABLE FILTERS & OVERLAYS SELECTOR DECK
   ============================================================================ */
.effects-selector-deck {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  background: #141716;
  padding: 0.45rem 0.55rem;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.selector-row {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.row-label {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  font-size: 0.58rem;
  font-weight: 700;
  color: #9ca3af;
  min-width: 52px;
  flex-shrink: 0;
}

.scroll-pills {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  overflow-x: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
  padding-bottom: 1px;

  &::-webkit-scrollbar {
    display: none;
  }
}

.preset-chip {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.22rem;
  font-size: 0.66rem;
  padding: 0.28rem 0.58rem;
  border-radius: var(--radius-pill);
  background: #232826;
  color: #c7c2b8;
  border: 1px solid rgba(255, 255, 255, 0.08);

  &.active {
    background: var(--muted-gold);
    color: var(--charcoal);
    font-weight: 700;
  }

  &.overlay-chip.active {
    background: var(--xmas-red);
    color: var(--bg-cream);
    border-color: var(--xmas-red-light);
  }

  &.date-chip.active {
    color: #ff9838;
    border-color: rgba(255, 152, 56, 0.5);
    background: rgba(255, 152, 56, 0.14);
  }
}

/* SHUTTER DECK */
.shutter-control-deck {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 0.6rem;
  padding-top: 0.1rem;
}

.deck-side-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.22rem;
  min-height: 54px;
  padding: 0.45rem;
  border-radius: 14px;
  background: #232725;
  color: #d6d1c7;
  border: 1.5px solid #323835;

  &.active {
    background: rgba(255, 152, 56, 0.14);
    color: #ffb457;
    border-color: rgba(255, 152, 56, 0.45);
  }

  &:disabled {
    opacity: 0.45;
  }

  .side-btn-label {
    font-size: 0.62rem;
    font-weight: 700;
  }
}

.shutter-housing {
  display: flex;
  align-items: center;
  justify-content: center;
}

.shutter-release-btn {
  width: 74px;
  height: 74px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #e05a53, var(--xmas-red) 60%, #7d201c 100%);
  border: 4px solid var(--muted-gold);
  box-shadow: 0 6px 18px rgba(181, 59, 53, 0.48);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--bg-cream);

  .shutter-inner-ring {
    width: 54px;
    height: 54px;
    border-radius: 50%;
    border: 1.5px dashed rgba(245, 240, 230, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &:active:not(:disabled) {
    transform: scale(0.92);
  }

  &:disabled {
    background: #3b403e;
    border-color: #525855;
    box-shadow: none;
    color: #7c827f;
  }
}

.developed-toast {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  background: rgba(24, 61, 50, 0.95);
  color: #a7f3d0;
  border: 1px solid #34d399;
  padding: 0.45rem 0.75rem;
  border-radius: 10px;
  font-size: 0.74rem;
}

/* PREVIEW MODAL */
.capture-preview-modal {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(12, 15, 14, 0.92);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.65rem;
}

.preview-card {
  width: 100%;
  max-width: 420px;
  padding: 0.9rem;
  color: var(--charcoal);
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.preview-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;

  h2 {
    font-size: 1.15rem;
    color: var(--forest-green);
  }

  .confirm-subtitle {
    font-size: 0.65rem;
    color: var(--charcoal-muted);
    margin-top: 0.15rem;
  }
}

.pending-recovery-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  flex-wrap: wrap;
  background: rgba(217, 164, 65, 0.15);
  border: 1px solid rgba(217, 164, 65, 0.45);
  border-radius: 10px;
  padding: 0.5rem 0.65rem;
  font-size: 0.72rem;
  color: #f7f2e7;

  .pending-recovery-info {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex: 1;
    min-width: 180px;

    .warn-icon {
      color: #f2c97d;
      flex-shrink: 0;
    }
  }

  .pending-recovery-actions {
    display: flex;
    gap: 0.35rem;
  }

  .btn-xs {
    padding: 0.3rem 0.55rem;
    font-size: 0.68rem;
    min-height: 30px;
  }

  .discard-pending-btn {
    color: #e5e7eb;
    border-color: rgba(255, 255, 255, 0.25);
  }
}

.upload-progress-box {
  background: var(--bg-cream-muted);
  border: 1px solid var(--charcoal-border);
  border-radius: 8px;
  padding: 0.45rem 0.65rem;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;

  .progress-top {
    display: flex;
    justify-content: space-between;
    font-size: 0.68rem;
    color: var(--forest-green);
    font-weight: 700;
  }

  .progress-track {
    height: 6px;
    border-radius: 99px;
    background: var(--bg-cream-deep);
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: var(--forest-green);
    transition: width 0.2s ease;
  }
}

.preview-tabs {
  display: flex;
  background: var(--bg-cream-muted);
  padding: 0.2rem;
  border-radius: 8px;
  gap: 0.2rem;
}

.preview-tab {
  font-size: 0.68rem;
  font-weight: 700;
  padding: 0.28rem 0.55rem;
  border-radius: 6px;
  color: var(--charcoal-soft);

  &.active {
    background: var(--forest-green);
    color: var(--bg-cream);
  }
}

.preview-image-frame {
  width: 100%;
  max-width: min(100%, calc(52dvh * 2 / 3));
  aspect-ratio: 2 / 3;
  margin: 0 auto;
  background: #101211;
  border-radius: 10px;
  overflow: hidden;

  .preview-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
}

.preview-effects-bar {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  background: var(--bg-cream-muted);
  padding: 0.45rem;
  border-radius: 10px;
}

.preview-pill {
  flex-shrink: 0;
  font-size: 0.66rem;
  padding: 0.26rem 0.58rem;
  border-radius: var(--radius-pill);
  background: var(--bg-cream-elevated);
  color: var(--charcoal-soft);
  border: 1px solid var(--charcoal-border);

  &.active {
    background: var(--forest-green);
    color: var(--bg-cream);
    font-weight: 700;
  }

  &.overlay.active {
    background: var(--xmas-red);
    color: var(--bg-cream);
  }
}

.preview-error {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.6rem 0.75rem;
  border-radius: 8px;
  background: var(--xmas-red-subtle);
  color: var(--xmas-red-dark);
  font-size: 0.8rem;
}

.preview-actions {
  display: grid;
  grid-template-columns: 1fr 1.5fr;
  gap: 0.5rem;

  .btn {
    min-height: 46px;
    padding: 0.65rem 0.8rem;
    font-size: 0.88rem;
  }
}

@media (max-width: 420px) {
  .preview-actions {
    grid-template-columns: 1fr;
  }
}
</style>
