<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  AlertTriangle,
  Archive,
  ArrowUpDown,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Film,
  Maximize2,
  Minimize2,
  RefreshCw,
  Users,
  X
} from 'lucide-vue-next'
import GuestHeader from '../components/GuestHeader.vue'
import {
  downloadAllGuestHdOriginalsAsZip,
  downloadOriginalPhotoFromIndexedDb,
  getOriginalPhoto
} from '../services/indexedDbStorage'
import { fetchPublicPartyPhotos } from '../services/repository'
import { downloadSinglePhoto } from '../services/zipExporter'
import { useSessionStore } from '../stores/sessionStore'
import type { PhotoRecord } from '../types'

const sessionStore = useSessionStore()
const router = useRouter()

const activeSegment = ref<'mine' | 'everyone'>('mine')
const partyPhotos = ref<PhotoRecord[]>([])
const timeSortOrder = ref<'newest' | 'oldest'>('newest')
const isLoadingFeed = ref(false)

type GridColumnCount = 1 | 2 | 3
const GRID_COLUMN_OPTIONS: readonly GridColumnCount[] = [1, 2, 3]
const GRID_COLS_STORAGE_KEY = 'xmas_roll_gallery_columns'

function getInitialGridColumns(): GridColumnCount {
  if (typeof window !== 'undefined') {
    const saved = window.localStorage?.getItem(GRID_COLS_STORAGE_KEY)
    if (saved === '1' || saved === '2' || saved === '3') {
      return Number(saved) as GridColumnCount
    }
    if (window.innerWidth <= 600) return 1
    if (window.innerWidth <= 900) return 2
  }
  return 3
}

const gridColumns = ref<GridColumnCount>(getInitialGridColumns())

function setGridColumns(cols: GridColumnCount) {
  gridColumns.value = cols
  if (typeof window !== 'undefined') {
    try {
      window.localStorage?.setItem(GRID_COLS_STORAGE_KEY, String(cols))
    } catch {
      // Ignore storage quota / private mode errors
    }
  }
}

const activeLightboxPhoto = ref<PhotoRecord | null>(null)
const lightboxViewMode = ref<'compressed' | 'hd-original'>('compressed')
const lightboxHdObjectUrl = ref<string>('')
const showViewerControls = ref(true)

const viewerRef = ref<HTMLElement | null>(null)
const isNativeFullscreen = ref(false)
const canUseNativeFullscreen = computed(
  () => typeof document !== 'undefined' && Boolean(document.fullscreenEnabled)
)

const isDownloading = ref(false)
const isDownloadingZip = ref(false)
const zipProgressText = ref('')
const retryingPhotoId = ref<string | null>(null)
const galleryFeedback = ref('')
const galleryError = ref('')
let toastTimeout: ReturnType<typeof setTimeout> | null = null

// Touch swipe state for mobile full-screen navigation
const touchStartX = ref<number | null>(null)
const touchStartY = ref<number | null>(null)

const sortedPartyPhotos = computed(() => {
  return [...partyPhotos.value].sort((a, b) => {
    if (timeSortOrder.value === 'newest') {
      return b.capturedAt.localeCompare(a.capturedAt)
    }
    return a.capturedAt.localeCompare(b.capturedAt)
  })
})

const currentPhotoList = computed<PhotoRecord[]>(() => {
  return activeSegment.value === 'mine' ? sessionStore.guestPhotos : sortedPartyPhotos.value
})

const activePhotoIndex = computed(() => {
  if (!activeLightboxPhoto.value) return -1
  return currentPhotoList.value.findIndex((p) => p.id === activeLightboxPhoto.value?.id)
})

const hasPrevPhoto = computed(() => activePhotoIndex.value > 0)
const hasNextPhoto = computed(
  () => activePhotoIndex.value >= 0 && activePhotoIndex.value < currentPhotoList.value.length - 1
)

const localHdAvailableCount = computed(() => {
  return sessionStore.localOriginals.filter((r) => r.imageBlob && r.imageBlob.size > 0).length
})

const isOwnLightboxPhoto = computed(() => {
  if (!activeLightboxPhoto.value || !sessionStore.guest) return false
  return activeLightboxPhoto.value.guestId === sessionStore.guest.id
})

const activePhotoHasLocalHd = computed(() => {
  if (!activeLightboxPhoto.value) return false
  return sessionStore.hasLocalOriginal(activeLightboxPhoto.value.id)
})

const activeViewerImageSrc = computed(() => {
  if (!activeLightboxPhoto.value) return ''
  if (lightboxViewMode.value === 'hd-original' && lightboxHdObjectUrl.value) {
    return lightboxHdObjectUrl.value
  }
  return activeLightboxPhoto.value.compressedImage || activeLightboxPhoto.value.imageUrl
})

function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) {
    return err.message
  }
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const msg = (err as { message?: unknown }).message
    if (typeof msg === 'string' && msg.trim().length > 0) {
      return msg
    }
  }
  return fallback
}

function revokeLightboxHdUrl() {
  if (lightboxHdObjectUrl.value && typeof URL !== 'undefined' && URL.revokeObjectURL) {
    URL.revokeObjectURL(lightboxHdObjectUrl.value)
  }
  lightboxHdObjectUrl.value = ''
}

function openFullscreenViewer(photo: PhotoRecord) {
  activeLightboxPhoto.value = photo
  showViewerControls.value = true
}

async function closeFullscreenViewer() {
  if (typeof document !== 'undefined' && document.fullscreenElement) {
    try {
      await document.exitFullscreen()
    } catch {
      // Ignore fullscreen exit errors
    }
  }
  activeLightboxPhoto.value = null
}

function goToPrevPhoto() {
  if (!hasPrevPhoto.value) return
  const prev = currentPhotoList.value[activePhotoIndex.value - 1]
  if (prev) activeLightboxPhoto.value = prev
}

function goToNextPhoto() {
  if (!hasNextPhoto.value) return
  const next = currentPhotoList.value[activePhotoIndex.value + 1]
  if (next) activeLightboxPhoto.value = next
}

async function toggleNativeFullscreen() {
  if (typeof document === 'undefined') return
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen()
    } else if (viewerRef.value?.requestFullscreen) {
      await viewerRef.value.requestFullscreen()
    }
  } catch {
    // Fallback gracefully if browser blocks fullscreen request
  }
}

function handleFullscreenChange() {
  if (typeof document === 'undefined') return
  isNativeFullscreen.value = Boolean(document.fullscreenElement)
}

function handleKeydown(event: KeyboardEvent) {
  if (!activeLightboxPhoto.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    void closeFullscreenViewer()
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault()
    goToPrevPhoto()
  } else if (event.key === 'ArrowRight') {
    event.preventDefault()
    goToNextPhoto()
  }
}

function handleViewerTouchStart(event: TouchEvent) {
  const touch = event.touches[0]
  if (!touch) return
  touchStartX.value = touch.clientX
  touchStartY.value = touch.clientY
}

function handleViewerTouchEnd(event: TouchEvent) {
  if (touchStartX.value === null || touchStartY.value === null) return
  const touch = event.changedTouches[0]
  if (!touch) return

  const deltaX = touch.clientX - touchStartX.value
  const deltaY = touch.clientY - touchStartY.value
  touchStartX.value = null
  touchStartY.value = null

  if (Math.abs(deltaX) > 48 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) {
    if (deltaX < 0) {
      goToNextPhoto()
    } else {
      goToPrevPhoto()
    }
  }
}

watch(activeLightboxPhoto, async (photo) => {
  revokeLightboxHdUrl()
  lightboxViewMode.value = 'compressed'

  if (typeof document !== 'undefined') {
    document.body.style.overflow = photo ? 'hidden' : ''
  }

  if (!photo) return

  if (sessionStore.guest && photo.guestId === sessionStore.guest.id) {
    try {
      const localRec = await getOriginalPhoto(photo.id)
      if (activeLightboxPhoto.value?.id !== photo.id) return
      if (localRec?.imageBlob && localRec.imageBlob.size > 0) {
        if (typeof URL !== 'undefined' && URL.createObjectURL) {
          lightboxHdObjectUrl.value = URL.createObjectURL(localRec.imageBlob)
          lightboxViewMode.value = 'hd-original'
        }
      }
    } catch {
      // Keep compressed fallback if IndexedDB read fails
    }
  }
})

onMounted(async () => {
  window.addEventListener('keydown', handleKeydown)
  document.addEventListener('fullscreenchange', handleFullscreenChange)

  const hasSession = await sessionStore.hydrateGuestSession()
  if (!hasSession) {
    router.replace('/register')
    return
  }
  await loadEveryonePhotos()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
  document.removeEventListener('fullscreenchange', handleFullscreenChange)
  if (toastTimeout) {
    clearTimeout(toastTimeout)
    toastTimeout = null
  }
  if (typeof document !== 'undefined') {
    document.body.style.overflow = ''
  }
  revokeLightboxHdUrl()
})

function showToast(msg: string) {
  galleryFeedback.value = msg
  if (toastTimeout) {
    clearTimeout(toastTimeout)
  }
  toastTimeout = setTimeout(() => {
    if (galleryFeedback.value === msg) galleryFeedback.value = ''
    toastTimeout = null
  }, 4000)
}

async function loadEveryonePhotos() {
  isLoadingFeed.value = true
  try {
    partyPhotos.value = await fetchPublicPartyPhotos(sessionStore.event.id)
  } catch (err: unknown) {
    galleryError.value = extractErrorMessage(err, 'Failed to load party photos.')
  } finally {
    isLoadingFeed.value = false
  }
}

function toggleTimeSort() {
  timeSortOrder.value = timeSortOrder.value === 'newest' ? 'oldest' : 'newest'
}

function formatCaptureTimestamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit'
  })
}

async function handleDownloadCompressed(photo: PhotoRecord) {
  isDownloading.value = true
  galleryError.value = ''
  try {
    const saved = await downloadSinglePhoto(photo, {
      includeTimestamp: false,
      useOriginal: false
    })
    showToast(`Saved ${saved}`)
  } catch (err: unknown) {
    galleryError.value = extractErrorMessage(err, 'Failed to download photo.')
  } finally {
    isDownloading.value = false
  }
}

async function handleDownloadHdOriginal(photo: PhotoRecord) {
  isDownloading.value = true
  galleryError.value = ''
  try {
    const result = await downloadOriginalPhotoFromIndexedDb(photo.id, photo.filename)
    showToast(`Saved HD photo (${result.filename})`)
  } catch (err: unknown) {
    galleryError.value = extractErrorMessage(
      err,
      'HD Original is not available on this device. Try downloading the standard photo.'
    )
  } finally {
    isDownloading.value = false
  }
}

async function handleDownloadAllHdAsZip() {
  if (!sessionStore.guest || isDownloadingZip.value) return
  isDownloadingZip.value = true
  galleryError.value = ''
  zipProgressText.value = 'Preparing ZIP...'

  try {
    const result = await downloadAllGuestHdOriginalsAsZip(
      sessionStore.guest.id,
      sessionStore.guest.fullName,
      sessionStore.event.id,
      (done, total) => {
        zipProgressText.value = `Packing (${done}/${total})...`
      }
    )
    showToast(`Downloaded ${result.exportedCount} photo(s) as ZIP!`)
  } catch (err: unknown) {
    galleryError.value = extractErrorMessage(err, 'No local HD photos found on this device.')
  } finally {
    isDownloadingZip.value = false
    zipProgressText.value = ''
  }
}

async function handleRetryPendingUpload(photoId: string) {
  if (retryingPhotoId.value) return
  retryingPhotoId.value = photoId
  galleryError.value = ''
  try {
    const uploaded = await sessionStore.retryFailedPhotoUpload(photoId)
    await loadEveryonePhotos()
    showToast(`Photo #${uploaded.shotNumber} uploaded!`)
  } catch (err: unknown) {
    galleryError.value = extractErrorMessage(err, 'Retry failed. Your shot was not consumed.')
  } finally {
    retryingPhotoId.value = null
  }
}

async function handleDiscardPending(photoId: string) {
  if (retryingPhotoId.value) return
  try {
    await sessionStore.discardFailedPhotoUpload(photoId)
    showToast('Discarded unsent photo.')
  } catch (err: unknown) {
    galleryError.value = extractErrorMessage(err, 'Could not discard unsent photo.')
  }
}
</script>

<template>
  <div class="guest-gallery-page">
    <GuestHeader />

    <main class="gallery-main">
      <!-- FEEDBACK / ERROR BANNERS -->
      <div v-if="galleryFeedback" class="gallery-toast" role="status">
        <Check :size="16" />
        <span>{{ galleryFeedback }}</span>
      </div>
      <div v-if="galleryError" class="gallery-error-banner" role="alert">
        <AlertTriangle :size="16" />
        <span>{{ galleryError }}</span>
        <button type="button" class="dismiss-link" @click="galleryError = ''">Dismiss</button>
      </div>

      <!-- SIMPLE TOP HEADER -->
      <header class="gallery-header">
        <div class="gallery-identity">
          <h1>{{ sessionStore.guest?.fullName }}</h1>
          <p class="shots-subtitle font-mono">
            <span data-testid="shots-used-val">{{ sessionStore.usedShots }}</span>
            / {{ sessionStore.totalShots }} shots used ·
            <span data-testid="shots-remaining-val">{{ sessionStore.remainingShots }}</span>
            left
          </p>
        </div>

        <div class="gallery-actions">
          <button
            v-if="localHdAvailableCount > 0"
            type="button"
            class="btn btn-outline btn-compact"
            :disabled="isDownloadingZip"
            data-testid="download-all-hd-zip-btn"
            @click="handleDownloadAllHdAsZip"
          >
            <Archive :size="16" />
            <span>
              {{
                isDownloadingZip
                  ? zipProgressText || 'Zipping...'
                  : `Save All (${localHdAvailableCount})`
              }}
            </span>
          </button>

          <button
            v-if="!sessionStore.isRollExhausted"
            type="button"
            class="btn btn-red btn-compact"
            @click="router.push('/camera')"
          >
            <Camera :size="16" />
            <span>Camera</span>
          </button>
        </div>
      </header>

      <!-- PENDING UPLOADS (ONLY SHOWN IF NEEDED) -->
      <section
        v-if="sessionStore.pendingUploads.length > 0"
        class="pending-strip"
        data-testid="pending-uploads-section"
      >
        <div class="pending-strip-head">
          <AlertTriangle :size="16" class="warn-icon" />
          <span>{{ sessionStore.pendingUploads.length }} photo(s) waiting to upload</span>
        </div>

        <div class="pending-list">
          <div v-for="item in sessionStore.pendingUploads" :key="item.id" class="pending-item">
            <span class="font-mono pending-label">
              Shot #{{ item.shotNumber || '?' }} · {{ formatCaptureTimestamp(item.capturedAt) }}
            </span>
            <div class="pending-item-actions">
              <button
                type="button"
                class="btn btn-primary btn-xs"
                :disabled="Boolean(retryingPhotoId)"
                data-testid="retry-upload-btn"
                @click="handleRetryPendingUpload(item.photoId)"
              >
                <RefreshCw :size="13" />
                <span>{{ retryingPhotoId === item.photoId ? 'Uploading...' : 'Retry' }}</span>
              </button>
              <button
                type="button"
                class="btn btn-outline btn-xs"
                :disabled="Boolean(retryingPhotoId)"
                @click="handleDiscardPending(item.photoId)"
              >
                <span>Discard</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- CLEAN TABS BAR -->
      <div class="toolbar-row">
        <div class="segment-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            :aria-selected="activeSegment === 'mine'"
            class="seg-tab"
            :class="{ active: activeSegment === 'mine' }"
            @click="activeSegment = 'mine'"
          >
            <Film :size="15" />
            <span>My Photos ({{ sessionStore.guestPhotos.length }})</span>
          </button>

          <button
            type="button"
            role="tab"
            :aria-selected="activeSegment === 'everyone'"
            class="seg-tab"
            :class="{ active: activeSegment === 'everyone' }"
            @click="
              activeSegment = 'everyone';
              loadEveryonePhotos()
            "
          >
            <Users :size="15" />
            <span>Everyone ({{ partyPhotos.length }})</span>
          </button>
        </div>

        <div class="toolbar-controls">
          <div class="col-switcher" role="group" aria-label="Grid columns">
            <button
              v-for="cols in GRID_COLUMN_OPTIONS"
              :key="cols"
              type="button"
              class="col-btn"
              :class="{ active: gridColumns === cols }"
              :aria-pressed="gridColumns === cols"
              :aria-label="`${cols} ${cols === 1 ? 'column' : 'columns'}`"
              :title="`${cols} ${cols === 1 ? 'column' : 'columns'}`"
              :data-testid="`grid-cols-${cols}-btn`"
              @click="setGridColumns(cols)"
            >
              <span class="col-bars" aria-hidden="true">
                <span v-for="bar in cols" :key="bar" class="col-bar"></span>
              </span>
              <span class="col-num font-mono">{{ cols }}</span>
            </button>
          </div>

          <div v-if="activeSegment === 'everyone'" class="feed-controls">
            <button type="button" class="chip-btn" @click="toggleTimeSort">
              <ArrowUpDown :size="14" />
              <span>{{ timeSortOrder === 'newest' ? 'Newest' : 'Oldest' }}</span>
            </button>

            <button
              type="button"
              class="chip-btn"
              :disabled="isLoadingFeed"
              aria-label="Refresh party feed"
              @click="loadEveryonePhotos"
            >
              <RefreshCw :size="14" :class="{ spinning: isLoadingFeed }" />
            </button>
          </div>
        </div>
      </div>

      <!-- PHOTO GRID (1, 2, OR 3 COLUMNS) -->
      <section
        v-if="currentPhotoList.length > 0"
        class="photo-grid"
        :class="`cols-${gridColumns}`"
        data-testid="photo-grid"
      >
        <button
          v-for="photo in currentPhotoList"
          :key="photo.id"
          type="button"
          class="photo-card"
          :aria-label="`View ${photo.guestName} photo #${photo.shotNumber} full screen`"
          @click="openFullscreenViewer(photo)"
        >
          <img
            :src="photo.compressedImage || photo.imageUrl"
            :alt="photo.filename"
            loading="lazy"
            class="photo-thumb"
          />

          <span class="expand-hint" aria-hidden="true">
            <Maximize2 :size="15" />
          </span>

          <span class="photo-caption">
            <span class="caption-primary">
              {{
                activeSegment === 'mine'
                  ? `#${String(photo.shotNumber).padStart(2, '0')}`
                  : photo.guestName
              }}
            </span>
            <span class="caption-time font-mono">
              {{ formatCaptureTimestamp(photo.capturedAt) }}
            </span>
          </span>
        </button>
      </section>

      <!-- EMPTY STATE -->
      <section v-else class="empty-state">
        <div class="empty-icon">
          <Film v-if="activeSegment === 'mine'" :size="28" />
          <Users v-else :size="28" />
        </div>
        <h2>{{ activeSegment === 'mine' ? 'No photos yet' : 'No party photos yet' }}</h2>
        <p>
          {{
            activeSegment === 'mine'
              ? `You have ${sessionStore.remainingShots} shots left on your roll.`
              : 'Be the first to share a moment from tonight’s party.'
          }}
        </p>
        <button
          v-if="!sessionStore.isRollExhausted"
          type="button"
          class="btn btn-red"
          @click="router.push('/camera')"
        >
          <Camera :size="18" />
          <span>Open Camera</span>
        </button>
      </section>
    </main>

    <!-- TRUE FULL-SCREEN PHOTO VIEWER -->
    <Teleport to="body">
      <Transition name="viewer-fade">
        <div
          v-if="activeLightboxPhoto"
          ref="viewerRef"
          class="fullscreen-viewer"
          role="dialog"
          aria-modal="true"
          aria-label="Full screen photo viewer"
          @touchstart.passive="handleViewerTouchStart"
          @touchend.passive="handleViewerTouchEnd"
        >
          <!-- TOP OVERLAY BAR -->
          <div class="viewer-top-bar" :class="{ 'is-hidden': !showViewerControls }">
            <div class="viewer-meta">
              <strong class="viewer-title">
                {{ activeLightboxPhoto.guestName }} · #{{
                  String(activeLightboxPhoto.shotNumber).padStart(2, '0')
                }}
              </strong>
              <span class="viewer-sub font-mono">
                {{ formatCaptureTimestamp(activeLightboxPhoto.capturedAt) }}
                <template v-if="activePhotoIndex >= 0">
                  · {{ activePhotoIndex + 1 }} / {{ currentPhotoList.length }}
                </template>
              </span>
            </div>

            <div class="viewer-top-actions">
              <button
                v-if="isOwnLightboxPhoto && lightboxHdObjectUrl"
                type="button"
                class="viewer-pill-btn font-mono"
                @click.stop="
                  lightboxViewMode =
                    lightboxViewMode === 'hd-original' ? 'compressed' : 'hd-original'
                "
              >
                {{ lightboxViewMode === 'hd-original' ? 'HD' : 'STD' }}
              </button>

              <button
                v-if="canUseNativeFullscreen"
                type="button"
                class="viewer-icon-btn"
                :aria-label="isNativeFullscreen ? 'Exit full screen' : 'Enter full screen'"
                :title="isNativeFullscreen ? 'Exit full screen' : 'Full screen'"
                @click.stop="toggleNativeFullscreen"
              >
                <Minimize2 v-if="isNativeFullscreen" :size="20" />
                <Maximize2 v-else :size="20" />
              </button>

              <button
                type="button"
                class="viewer-icon-btn"
                aria-label="Close"
                title="Close (Esc)"
                @click.stop="closeFullscreenViewer"
              >
                <X :size="22" />
              </button>
            </div>
          </div>

          <!-- FLOATING VIEWER FEEDBACK -->
          <div v-if="galleryFeedback || galleryError" class="viewer-status-pill" role="status">
            <span>{{ galleryError || galleryFeedback }}</span>
          </div>

          <!-- MAIN FULL-SCREEN IMAGE STAGE -->
          <div class="viewer-stage" @click="showViewerControls = !showViewerControls">
            <button
              v-if="hasPrevPhoto"
              type="button"
              class="viewer-nav-btn prev"
              :class="{ 'is-hidden': !showViewerControls }"
              aria-label="Previous photo"
              @click.stop="goToPrevPhoto"
            >
              <ChevronLeft :size="28" />
            </button>

            <img
              :src="activeViewerImageSrc"
              :alt="activeLightboxPhoto.filename"
              class="viewer-image"
            />

            <button
              v-if="hasNextPhoto"
              type="button"
              class="viewer-nav-btn next"
              :class="{ 'is-hidden': !showViewerControls }"
              aria-label="Next photo"
              @click.stop="goToNextPhoto"
            >
              <ChevronRight :size="28" />
            </button>
          </div>

          <!-- BOTTOM OVERLAY BAR -->
          <div class="viewer-bottom-bar" :class="{ 'is-hidden': !showViewerControls }">
            <button
              v-if="isOwnLightboxPhoto && activePhotoHasLocalHd"
              type="button"
              class="viewer-action-btn primary"
              :disabled="isDownloading"
              data-testid="download-hd-original-btn"
              @click.stop="handleDownloadHdOriginal(activeLightboxPhoto)"
            >
              <Download :size="17" />
              <span>{{ isDownloading ? 'Saving...' : 'Download HD' }}</span>
            </button>

            <button
              type="button"
              class="viewer-action-btn"
              :class="{ primary: !(isOwnLightboxPhoto && activePhotoHasLocalHd) }"
              :disabled="isDownloading"
              data-testid="download-compressed-btn"
              @click.stop="handleDownloadCompressed(activeLightboxPhoto)"
            >
              <Download :size="17" />
              <span>
                {{
                  isDownloading
                    ? 'Saving...'
                    : isOwnLightboxPhoto && activePhotoHasLocalHd
                      ? 'Standard'
                      : 'Download Photo'
                }}
              </span>
            </button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped lang="scss">
.guest-gallery-page {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
}

.gallery-main {
  flex: 1;
  width: 100%;
  max-width: 1120px;
  margin: 0 auto;
  padding: 1.25rem 1rem 3rem;
  display: flex;
  flex-direction: column;
  gap: 1.15rem;
}

/* TOASTS / ERRORS */
.gallery-toast {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.7rem 1rem;
  border-radius: var(--radius-md);
  background: var(--forest-green);
  color: var(--bg-cream);
  font-size: 0.85rem;
  font-weight: 600;
}

.gallery-error-banner {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.7rem 1rem;
  border-radius: var(--radius-md);
  background: var(--xmas-red-subtle);
  border: 1px solid rgba(181, 59, 53, 0.3);
  color: var(--xmas-red-dark);
  font-size: 0.85rem;

  .dismiss-link {
    margin-left: auto;
    font-weight: 700;
    text-decoration: underline;
    color: inherit;
  }
}

/* SIMPLE HEADER */
.gallery-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.85rem;
  flex-wrap: wrap;
}

.gallery-identity {
  h1 {
    font-size: 1.55rem;
    color: var(--forest-green);
    line-height: 1.15;
  }

  .shots-subtitle {
    margin-top: 0.2rem;
    font-size: 0.78rem;
    color: var(--charcoal-muted);
  }
}

.gallery-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.btn-compact {
  padding: 0.58rem 1.05rem;
  font-size: 0.86rem;
}

/* PENDING UPLOADS STRIP */
.pending-strip {
  background: var(--bg-cream-elevated);
  border: 1px solid var(--muted-gold);
  border-radius: var(--radius-md);
  padding: 0.85rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.pending-strip-head {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.85rem;
  font-weight: 700;
  color: #7c5819;

  .warn-icon {
    flex-shrink: 0;
  }
}

.pending-list {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.pending-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.pending-label {
  font-size: 0.74rem;
  color: var(--charcoal-soft);
}

.pending-item-actions {
  display: flex;
  gap: 0.4rem;
}

.btn-xs {
  padding: 0.35rem 0.7rem;
  font-size: 0.75rem;
}

/* TABS & FEED CONTROLS */
.toolbar-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.65rem;
  flex-wrap: wrap;
}

.segment-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.25rem;
  background: var(--bg-cream-muted);
  padding: 0.25rem;
  border-radius: var(--radius-pill);
  border: 1px solid var(--charcoal-border);
  flex: 1;
  max-width: 420px;
}

.seg-tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  min-height: 40px;
  padding: 0.45rem 0.9rem;
  border-radius: var(--radius-pill);
  font-size: 0.86rem;
  font-weight: 600;
  color: var(--charcoal-soft);
  transition: background-color 0.16s ease, color 0.16s ease;

  &.active {
    background: var(--forest-green);
    color: var(--bg-cream);
  }
}

.toolbar-controls {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  flex-wrap: wrap;
}

.col-switcher {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  background: var(--bg-cream-muted);
  padding: 0.22rem;
  border-radius: var(--radius-pill);
  border: 1px solid var(--charcoal-border);
}

.col-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  min-height: 34px;
  padding: 0.25rem 0.62rem;
  border-radius: var(--radius-pill);
  color: var(--charcoal-soft);
  font-size: 0.76rem;
  font-weight: 700;
  transition: background-color 0.15s ease, color 0.15s ease;

  &:hover:not(.active) {
    color: var(--forest-green);
  }

  &.active {
    background: var(--forest-green);
    color: var(--bg-cream);
  }
}

.col-bars {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 12px;
}

.col-bar {
  width: 3px;
  height: 100%;
  border-radius: 1px;
  background: currentColor;
  opacity: 0.85;
}

.feed-controls {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.chip-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  min-height: 38px;
  min-width: 38px;
  padding: 0.4rem 0.8rem;
  border-radius: var(--radius-pill);
  background: var(--bg-cream-elevated);
  border: 1px solid var(--charcoal-border);
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--forest-green);
  transition: border-color 0.15s ease;

  &:hover:not(:disabled) {
    border-color: var(--forest-green);
  }
}

.spinning {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* PHOTO GRID (1, 2, OR 3 COLUMNS) */
.photo-grid {
  display: grid;
  gap: 1rem;
  width: 100%;

  &.cols-1 {
    grid-template-columns: 1fr;
    max-width: 560px;
    margin-inline: auto;
  }

  &.cols-2 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  &.cols-3 {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

.photo-card {
  position: relative;
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  text-align: left;
  aspect-ratio: 2 / 3;
  border-radius: 16px;
  overflow: hidden;
  background: #141615;
  cursor: pointer;
  box-shadow: 0 8px 24px -8px rgba(0, 0, 0, 0.22);
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s ease;

  &:hover,
  &:focus-visible {
    transform: translateY(-2px);
    box-shadow: 0 14px 30px -8px rgba(0, 0, 0, 0.3);
    outline: none;

    .expand-hint {
      opacity: 1;
      transform: scale(1);
    }
  }

  &:focus-visible {
    box-shadow: 0 0 0 3px var(--forest-green);
  }
}

.photo-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.expand-hint {
  position: absolute;
  top: 0.65rem;
  right: 0.65rem;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.45);
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.8;
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.photo-caption {
  position: absolute;
  inset-inline: 0;
  bottom: 0;
  padding: 2rem 0.85rem 0.75rem;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.68) 0%, rgba(0, 0, 0, 0) 100%);
  color: #fff;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
}

.caption-primary {
  font-size: 0.9rem;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.caption-time {
  font-size: 0.72rem;
  color: rgba(255, 255, 255, 0.82);
  flex-shrink: 0;
}

/* EMPTY STATE */
.empty-state {
  padding: 3.5rem 1.25rem;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.65rem;

  .empty-icon {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: var(--forest-green-subtle);
    color: var(--forest-green);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  h2 {
    font-size: 1.35rem;
    color: var(--forest-green);
  }

  p {
    font-size: 0.9rem;
    color: var(--charcoal-muted);
    margin-bottom: 0.35rem;
  }
}

@media (max-width: 600px) {
  .gallery-main {
    padding: 0.9rem 0.75rem 2.5rem;
    gap: 0.9rem;
  }

  .segment-tabs {
    max-width: none;
    width: 100%;
    flex-basis: 100%;
  }

  .toolbar-controls {
    width: 100%;
    justify-content: space-between;
  }

  .photo-grid {
    &.cols-1 {
      gap: 0.9rem;
    }

    &.cols-2 {
      gap: 0.6rem;

      .photo-card {
        border-radius: 12px;
      }

      .expand-hint {
        width: 28px;
        height: 28px;
        top: 0.45rem;
        right: 0.45rem;
      }

      .photo-caption {
        padding: 1.4rem 0.55rem 0.5rem;
      }

      .caption-primary {
        font-size: 0.78rem;
      }

      .caption-time {
        font-size: 0.65rem;
      }
    }

    &.cols-3 {
      gap: 0.4rem;

      .photo-card {
        border-radius: 10px;
      }

      .expand-hint {
        display: none;
      }

      .photo-caption {
        padding: 1.1rem 0.4rem 0.35rem;
      }

      .caption-primary {
        font-size: 0.68rem;
      }

      .caption-time {
        display: none;
      }
    }
  }
}
</style>

<style lang="scss">
/* FULL-SCREEN VIEWER (TELEPORTED TO BODY) */
.fullscreen-viewer {
  position: fixed;
  inset: 0;
  z-index: 10000;
  width: 100vw;
  height: 100vh;
  height: 100dvh;
  background: #000;
  color: #fff;
  display: flex;
  flex-direction: column;
  -webkit-user-select: none;
  user-select: none;
}

.viewer-top-bar {
  position: absolute;
  top: 0;
  inset-inline: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: max(0.85rem, env(safe-area-inset-top)) 1rem 1.5rem;
  background: linear-gradient(to bottom, rgba(0, 0, 0, 0.72) 0%, rgba(0, 0, 0, 0) 100%);
  transition: opacity 0.2s ease;

  &.is-hidden {
    opacity: 0;
    pointer-events: none;
  }
}

.viewer-meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.viewer-title {
  font-size: 0.96rem;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.viewer-sub {
  font-size: 0.72rem;
  color: rgba(255, 255, 255, 0.72);
}

.viewer-top-actions {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  flex-shrink: 0;
}

.viewer-icon-btn {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.14);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.15s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.25);
  }
}

.viewer-pill-btn {
  height: 36px;
  padding: 0 0.75rem;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.16);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  color: #fff;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  transition: background-color 0.15s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.28);
  }
}

.viewer-status-pill {
  position: absolute;
  top: max(4.25rem, calc(env(safe-area-inset-top) + 3.5rem));
  left: 50%;
  transform: translateX(-50%);
  z-index: 25;
  padding: 0.45rem 0.95rem;
  border-radius: 9999px;
  background: rgba(24, 61, 50, 0.92);
  color: #f5f0e6;
  font-size: 0.8rem;
  font-weight: 600;
  max-width: calc(100vw - 2rem);
  text-align: center;
  pointer-events: none;
}

.viewer-stage {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  cursor: pointer;
}

.viewer-image {
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  display: block;
}

.viewer-nav-btn {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 15;
  width: 46px;
  height: 46px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.48);
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.15s ease, opacity 0.2s ease;

  &.prev {
    left: 0.85rem;
  }

  &.next {
    right: 0.85rem;
  }

  &:hover {
    background: rgba(0, 0, 0, 0.78);
  }

  &.is-hidden {
    opacity: 0;
    pointer-events: none;
  }
}

.viewer-bottom-bar {
  position: absolute;
  bottom: 0;
  inset-inline: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  padding: 1.5rem 1rem max(1rem, env(safe-area-inset-bottom));
  background: linear-gradient(to top, rgba(0, 0, 0, 0.76) 0%, rgba(0, 0, 0, 0) 100%);
  transition: opacity 0.2s ease;

  &.is-hidden {
    opacity: 0;
    pointer-events: none;
  }
}

.viewer-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  height: 44px;
  padding: 0 1.25rem;
  border-radius: 9999px;
  font-size: 0.88rem;
  font-weight: 600;
  color: #fff;
  background: rgba(255, 255, 255, 0.16);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  transition: background-color 0.15s ease, opacity 0.15s ease;

  &.primary {
    background: #fff;
    color: #111;

    &:hover:not(:disabled) {
      background: #f0ece3;
    }
  }

  &:hover:not(.primary):not(:disabled) {
    background: rgba(255, 255, 255, 0.26);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.viewer-fade-enter-active,
.viewer-fade-leave-active {
  transition: opacity 0.18s ease;
}

.viewer-fade-enter-from,
.viewer-fade-leave-to {
  opacity: 0;
}
</style>
