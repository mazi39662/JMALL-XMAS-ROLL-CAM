<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  AlertTriangle,
  Archive,
  ArrowUpDown,
  Camera,
  Check,
  Clock,
  Download,
  Film,
  HardDrive,
  Lock,
  RefreshCw,
  Users,
  X
} from 'lucide-vue-next'
import GuestHeader from '@/components/GuestHeader.vue'
import {
  downloadAllGuestHdOriginalsAsZip,
  downloadOriginalPhotoFromIndexedDb,
  getOriginalPhoto
} from '@/services/indexedDbStorage'
import { fetchPublicPartyPhotos } from '@/services/repository'
import { downloadSinglePhoto } from '@/services/zipExporter'
import { useSessionStore } from '@/stores/sessionStore'
import type { PhotoRecord } from '@/types'

const sessionStore = useSessionStore()
const router = useRouter()

const activeSegment = ref<'mine' | 'everyone'>('mine')
const partyPhotos = ref<PhotoRecord[]>([])
const timeSortOrder = ref<'newest' | 'oldest'>('newest')
const isLoadingFeed = ref(false)

const activeLightboxPhoto = ref<PhotoRecord | null>(null)
const lightboxViewMode = ref<'compressed' | 'hd-original'>('compressed')
const lightboxHdObjectUrl = ref<string>('')
const lightboxMissingHdNotice = ref<string>('')

const isDownloading = ref(false)
const isDownloadingZip = ref(false)
const zipProgressText = ref('')
const retryingPhotoId = ref<string | null>(null)
const galleryFeedback = ref('')
const galleryError = ref('')

const sortedPartyPhotos = computed(() => {
  return [...partyPhotos.value].sort((a, b) => {
    if (timeSortOrder.value === 'newest') {
      return b.capturedAt.localeCompare(a.capturedAt)
    }
    return a.capturedAt.localeCompare(b.capturedAt)
  })
})

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

function revokeLightboxHdUrl() {
  if (lightboxHdObjectUrl.value && typeof URL !== 'undefined' && URL.revokeObjectURL) {
    URL.revokeObjectURL(lightboxHdObjectUrl.value)
  }
  lightboxHdObjectUrl.value = ''
}

watch(activeLightboxPhoto, async (photo) => {
  revokeLightboxHdUrl()
  lightboxViewMode.value = 'compressed'
  lightboxMissingHdNotice.value = ''
  if (!photo) return

  if (sessionStore.guest && photo.guestId === sessionStore.guest.id) {
    const localRec = await getOriginalPhoto(photo.id)
    if (localRec?.imageBlob && localRec.imageBlob.size > 0) {
      if (typeof URL !== 'undefined' && URL.createObjectURL) {
        lightboxHdObjectUrl.value = URL.createObjectURL(localRec.imageBlob)
      }
    } else {
      lightboxMissingHdNotice.value =
        'HD Original is not stored on this device. Original high-resolution photos are saved only on the device where they were captured.'
    }
  }
})

onMounted(async () => {
  const hasSession = await sessionStore.hydrateGuestSession()
  if (!hasSession) {
    router.replace('/register')
    return
  }
  await Promise.all([sessionStore.refreshGuestRoll(), loadEveryonePhotos()])
})

onBeforeUnmount(() => {
  revokeLightboxHdUrl()
})

function showToast(msg: string) {
  galleryFeedback.value = msg
  setTimeout(() => {
    if (galleryFeedback.value === msg) galleryFeedback.value = ''
  }, 4000)
}

async function loadEveryonePhotos() {
  isLoadingFeed.value = true
  try {
    partyPhotos.value = await fetchPublicPartyPhotos(sessionStore.event.id)
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
    showToast(`Downloaded compressed photo (${saved})`)
  } catch (err: any) {
    galleryError.value = err?.message || 'Failed to download compressed photo.'
  } finally {
    isDownloading.value = false
  }
}

async function handleDownloadHdOriginal(photo: PhotoRecord) {
  isDownloading.value = true
  galleryError.value = ''
  try {
    const result = await downloadOriginalPhotoFromIndexedDb(photo.id, photo.filename)
    showToast(`Downloaded HD Original (${result.filename})`)
  } catch (err: any) {
    const msg =
      err?.message ||
      'HD Original is missing on this device. HD originals are stored only on the device used to capture the photo.'
    lightboxMissingHdNotice.value = msg
    galleryError.value = msg
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
        zipProgressText.value = `Packing HD (${done}/${total})...`
      }
    )
    showToast(`Downloaded ${result.exportedCount} HD Original photo(s) as ZIP!`)
  } catch (err: any) {
    galleryError.value =
      err?.message ||
      'No HD originals found in IndexedDB on this device. Originals are stored locally on the capturing device.'
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
    showToast(`Photo #${uploaded.shotNumber} successfully uploaded!`)
  } catch (err: any) {
    galleryError.value = err?.message || 'Retry failed. Your shot was not consumed.'
  } finally {
    retryingPhotoId.value = null
  }
}

async function handleDiscardPending(photoId: string) {
  if (retryingPhotoId.value) return
  await sessionStore.discardFailedPhotoUpload(photoId)
  showToast('Discarded unsent local capture.')
}
</script>

<template>
  <div class="guest-gallery-page">
    <GuestHeader />
    <div class="film-sprocket-bar" aria-hidden="true"></div>

    <main class="gallery-main">
      <!-- FEEDBACK / ERROR BANNERS -->
      <div v-if="galleryFeedback" class="gallery-toast font-mono" role="status">
        <Check :size="16" />
        <span>{{ galleryFeedback }}</span>
      </div>
      <div v-if="galleryError" class="gallery-error-banner" role="alert">
        <AlertTriangle :size="17" />
        <span>{{ galleryError }}</span>
        <button type="button" class="dismiss-link" @click="galleryError = ''">Dismiss</button>
      </div>

      <!-- ROLL SUMMARY HEADER -->
      <section class="roll-summary-card retro-card">
        <div class="summary-top">
          <div>
            <h1>{{ sessionStore.guest?.fullName }}’s Roll</h1>
            <p class="dept-line font-mono">{{ sessionStore.guest?.department }}</p>
          </div>

          <div class="summary-cta-group">
            <button
              v-if="sessionStore.guestPhotos.length > 0 || localHdAvailableCount > 0"
              type="button"
              class="btn btn-outline btn-sm-block"
              :disabled="isDownloadingZip || localHdAvailableCount === 0"
              data-testid="download-all-hd-zip-btn"
              @click="handleDownloadAllHdAsZip"
            >
              <Archive :size="16" />
              <span>
                {{
                  isDownloadingZip
                    ? zipProgressText || 'Creating HD ZIP...'
                    : `Download All HD Originals ZIP (${localHdAvailableCount})`
                }}
              </span>
            </button>

            <button
              v-if="!sessionStore.isRollExhausted"
              class="btn btn-red btn-sm-block"
              @click="router.push('/camera')"
            >
              <Camera :size="17" />
              <span>Open Camera ({{ sessionStore.remainingShots }} Left)</span>
            </button>
          </div>
        </div>

        <div class="shot-metrics-grid">
          <div class="metric-tile">
            <span class="metric-label font-mono">SHOTS USED</span>
            <strong class="metric-val used" data-testid="shots-used-val">
              {{ sessionStore.usedShots }} / {{ sessionStore.totalShots }}
            </strong>
          </div>

          <div class="metric-tile">
            <span class="metric-label font-mono">SHOTS LEFT</span>
            <strong class="metric-val remaining" data-testid="shots-remaining-val">
              {{ sessionStore.remainingShots }} / {{ sessionStore.totalShots }}
            </strong>
          </div>
        </div>

        <div class="permanent-roll-notice font-mono">
          <Lock :size="13" />
          <span>
            Dual Storage Active: HD Originals saved locally on your device · Compressed photos shared
            to the event gallery.
          </span>
        </div>

        <div
          v-if="sessionStore.guestPhotos.length > 0 && localHdAvailableCount < sessionStore.guestPhotos.length"
          class="missing-hd-banner font-mono"
          data-testid="missing-hd-banner"
        >
          <AlertTriangle :size="14" />
          <span>
            {{ sessionStore.guestPhotos.length - localHdAvailableCount }} photo(s) do not have a
            local HD original on this device (taken on another device or browser storage cleared).
            Compressed copies remain available.
          </span>
        </div>
      </section>

      <!-- PENDING / FAILED UPLOADS RECOVERY SECTION -->
      <section
        v-if="sessionStore.pendingUploads.length > 0"
        class="pending-uploads-card retro-card"
        data-testid="pending-uploads-section"
      >
        <div class="pending-header">
          <div class="pending-title">
            <AlertTriangle :size="18" class="warn-icon" />
            <div>
              <h2>Pending Photo Uploads ({{ sessionStore.pendingUploads.length }})</h2>
              <p>
                These HD photos are safely saved in your device's IndexedDB but haven't finished
                uploading to Firestore yet. No shot has been consumed yet.
              </p>
            </div>
          </div>
        </div>

        <div class="pending-list">
          <div
            v-for="item in sessionStore.pendingUploads"
            :key="item.id"
            class="pending-item-row"
          >
            <div class="pending-meta font-mono">
              <span class="status-pill pending">PENDING UPLOAD</span>
              <span>Shot #{{ item.shotNumber || '?' }}</span>
              <span>Captured {{ formatCaptureTimestamp(item.capturedAt) }}</span>
            </div>

            <div class="pending-actions">
              <button
                type="button"
                class="btn btn-primary btn-xs"
                :disabled="Boolean(retryingPhotoId)"
                data-testid="retry-upload-btn"
                @click="handleRetryPendingUpload(item.photoId)"
              >
                <RefreshCw :size="14" />
                <span>
                  {{ retryingPhotoId === item.photoId ? 'Uploading...' : 'Retry Upload' }}
                </span>
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

      <!-- SEGMENTED SWITCHER: MY PHOTOS vs EVERYONE'S PHOTOS -->
      <div class="segment-bar">
        <div class="segment-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            class="seg-tab"
            :class="{ active: activeSegment === 'mine' }"
            @click="activeSegment = 'mine'"
          >
            <Film :size="16" />
            <span>My Photos ({{ sessionStore.guestPhotos.length }})</span>
          </button>

          <button
            type="button"
            role="tab"
            class="seg-tab"
            :class="{ active: activeSegment === 'everyone' }"
            @click="
              activeSegment = 'everyone';
              loadEveryonePhotos()
            "
          >
            <Users :size="16" />
            <span>Everyone’s Photos ({{ partyPhotos.length }})</span>
          </button>
        </div>

        <!-- Time Sort & Refresh Controls for Everyone's Photos -->
        <div v-if="activeSegment === 'everyone'" class="feed-controls">
          <button type="button" class="sort-btn font-mono" @click="toggleTimeSort">
            <ArrowUpDown :size="14" />
            <span>{{ timeSortOrder === 'newest' ? 'Latest First' : 'Oldest First' }}</span>
          </button>

          <button
            type="button"
            class="sort-btn font-mono"
            :disabled="isLoadingFeed"
            aria-label="Refresh party feed"
            @click="loadEveryonePhotos"
          >
            <RefreshCw :size="14" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      <!-- ===================================================================
           SEGMENT 1: MY PHOTOS
           =================================================================== -->
      <template v-if="activeSegment === 'mine'">
        <section v-if="sessionStore.guestPhotos.length > 0" class="contact-sheet-grid">
          <article
            v-for="photo in sessionStore.guestPhotos"
            :key="photo.id"
            class="film-frame-card retro-card"
            @click="activeLightboxPhoto = photo"
          >
            <div class="frame-top-bar font-mono">
              <span>#{{ String(photo.shotNumber).padStart(2, '0') }}</span>
              <span class="capture-time">
                <Clock :size="11" />
                {{ formatCaptureTimestamp(photo.capturedAt) }}
              </span>
            </div>

            <div class="frame-img-wrap">
              <img
                :src="photo.compressedImage || photo.imageUrl"
                :alt="photo.filename"
                loading="lazy"
              />
            </div>

            <div class="frame-bottom-bar font-mono">
              <span class="upload-badge uploaded" data-testid="photo-upload-status">
                ✓ UPLOADED
              </span>
              <span
                class="hd-badge"
                :class="sessionStore.hasLocalOriginal(photo.id) ? 'available' : 'missing'"
              >
                {{ sessionStore.hasLocalOriginal(photo.id) ? 'HD LOCAL' : 'CLOUD ONLY' }}
              </span>
            </div>
          </article>
        </section>

        <section v-else class="empty-roll-card retro-card">
          <div class="empty-icon">
            <Film :size="32" />
          </div>
          <h2>No Photos Yet</h2>
          <p>You have {{ sessionStore.remainingShots }} shots ready to use.</p>
          <button class="btn btn-red" @click="router.push('/camera')">
            <Camera :size="18" />
            <span>Take Your First Photo</span>
          </button>
        </section>
      </template>

      <!-- ===================================================================
           SEGMENT 2: EVERYONE'S PHOTOS (COMPILATION SORTED BY TIME)
           =================================================================== -->
      <template v-else>
        <section v-if="sortedPartyPhotos.length > 0" class="contact-sheet-grid">
          <article
            v-for="photo in sortedPartyPhotos"
            :key="photo.id"
            class="film-frame-card retro-card"
            @click="activeLightboxPhoto = photo"
          >
            <div class="frame-top-bar font-mono">
              <span class="guest-tag">{{ photo.guestName }}</span>
              <span class="capture-time">
                <Clock :size="11" />
                {{ formatCaptureTimestamp(photo.capturedAt) }}
              </span>
            </div>

            <div class="frame-img-wrap">
              <img
                :src="photo.compressedImage || photo.imageUrl"
                :alt="photo.filename"
                loading="lazy"
              />
            </div>

            <div class="frame-bottom-bar font-mono">
              <span>{{ photo.department }}</span>
              <span>#{{ String(photo.shotNumber).padStart(2, '0') }}</span>
            </div>
          </article>
        </section>

        <section v-else class="empty-roll-card retro-card">
          <div class="empty-icon">
            <Users :size="32" />
          </div>
          <h2>No Party Photos Yet</h2>
          <p>Be the first guest to snap a photo for tonight’s party feed!</p>
          <button
            v-if="!sessionStore.isRollExhausted"
            class="btn btn-red"
            @click="router.push('/camera')"
          >
            <Camera :size="18" />
            <span>Open Camera</span>
          </button>
        </section>
      </template>
    </main>

    <!-- LIGHTBOX MODAL -->
    <Transition name="fade">
      <div
        v-if="activeLightboxPhoto"
        class="lightbox-backdrop"
        role="dialog"
        aria-modal="true"
        @click.self="activeLightboxPhoto = null"
      >
        <div class="lightbox-modal retro-card">
          <div class="lightbox-header">
            <div>
              <span class="badge badge-red">
                {{ activeLightboxPhoto.guestName }} · SHOT #{{ activeLightboxPhoto.shotNumber }}
              </span>
              <p class="font-mono lb-time">
                {{ activeLightboxPhoto.department }} ·
                {{ formatCaptureTimestamp(activeLightboxPhoto.capturedAt) }} · Status: UPLOADED
              </p>
            </div>
            <button
              type="button"
              class="close-btn"
              aria-label="Close"
              @click="activeLightboxPhoto = null"
            >
              <X :size="20" />
            </button>
          </div>

          <!-- Toggle between Compressed Firestore image and Local HD Original (when viewing own photo) -->
          <div v-if="isOwnLightboxPhoto && lightboxHdObjectUrl" class="lb-version-tabs font-mono">
            <button
              type="button"
              class="lb-tab"
              :class="{ active: lightboxViewMode === 'compressed' }"
              @click="lightboxViewMode = 'compressed'"
            >
              Compressed (75% JPEG)
            </button>
            <button
              type="button"
              class="lb-tab"
              :class="{ active: lightboxViewMode === 'hd-original' }"
              @click="lightboxViewMode = 'hd-original'"
            >
              HD Original (Local)
            </button>
          </div>

          <div class="lightbox-img-box">
            <img
              :src="
                lightboxViewMode === 'hd-original' && lightboxHdObjectUrl
                  ? lightboxHdObjectUrl
                  : activeLightboxPhoto.compressedImage || activeLightboxPhoto.imageUrl
              "
              :alt="activeLightboxPhoto.filename"
            />
          </div>

          <!-- Clear message if HD original is missing on this device -->
          <div
            v-if="isOwnLightboxPhoto && (!activePhotoHasLocalHd || lightboxMissingHdNotice)"
            class="lb-missing-hd-alert"
            role="note"
            data-testid="lightbox-missing-hd-msg"
          >
            <AlertTriangle :size="15" />
            <span>
              {{
                lightboxMissingHdNotice ||
                  'HD Original is missing on this device. High-resolution originals are stored locally on the device where the photo was taken.'
              }}
            </span>
          </div>

          <div class="lightbox-actions">
            <button
              v-if="isOwnLightboxPhoto"
              type="button"
              class="btn btn-primary btn-block"
              :disabled="isDownloading || !activePhotoHasLocalHd"
              data-testid="download-hd-original-btn"
              @click="handleDownloadHdOriginal(activeLightboxPhoto)"
            >
              <HardDrive :size="17" />
              <span>
                {{
                  !activePhotoHasLocalHd
                    ? 'HD Original Not On This Device'
                    : isDownloading
                      ? 'Saving HD...'
                      : 'Download HD Original (IndexedDB)'
                }}
              </span>
            </button>

            <button
              type="button"
              class="btn btn-outline btn-block"
              :disabled="isDownloading"
              data-testid="download-compressed-btn"
              @click="handleDownloadCompressed(activeLightboxPhoto)"
            >
              <Download :size="17" />
              <span>
                {{ isDownloading ? 'Saving...' : 'Download Compressed Photo (JPEG)' }}
              </span>
            </button>
          </div>
        </div>
      </div>
    </Transition>
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
  max-width: 960px;
  width: 100%;
  margin: 0 auto;
  padding: 1rem 0.85rem 2.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.gallery-toast {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  border-radius: var(--radius-md);
  background: var(--forest-green);
  color: var(--bg-cream);
  font-size: 0.82rem;
  font-weight: 700;
}

.gallery-error-banner {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.75rem 1rem;
  border-radius: var(--radius-md);
  background: var(--xmas-red-subtle);
  border: 1px solid rgba(181, 59, 53, 0.35);
  color: var(--xmas-red-dark);
  font-size: 0.84rem;

  .dismiss-link {
    margin-left: auto;
    font-weight: 700;
    text-decoration: underline;
    color: inherit;
  }
}

.roll-summary-card {
  padding: 1.15rem;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.summary-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;

  h1 {
    font-size: 1.45rem;
    color: var(--forest-green);
  }

  .dept-line {
    font-size: 0.75rem;
    color: var(--charcoal-muted);
  }
}

.summary-cta-group {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.shot-metrics-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.65rem;
}

.metric-tile {
  background: var(--bg-cream);
  border: 1px solid var(--charcoal-border);
  border-radius: var(--radius-md);
  padding: 0.7rem 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;

  .metric-label {
    font-size: 0.65rem;
    color: var(--charcoal-muted);
  }

  .metric-val {
    font-family: var(--font-display);
    font-size: 1.35rem;

    &.used {
      color: var(--forest-green);
    }
    &.remaining {
      color: var(--xmas-red);
    }
  }
}

.permanent-roll-notice {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.72rem;
  color: var(--charcoal-muted);
  background: var(--bg-cream-muted);
  padding: 0.48rem 0.75rem;
  border-radius: 8px;
}

.missing-hd-banner {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.7rem;
  color: #8a6421;
  background: var(--muted-gold-subtle);
  border: 1px solid var(--muted-gold);
  padding: 0.5rem 0.75rem;
  border-radius: 8px;
}

/* PENDING UPLOADS CARD */
.pending-uploads-card {
  padding: 1rem 1.15rem;
  border-left: 4px solid var(--muted-gold);
  display: flex;
  flex-direction: column;
  gap: 0.75rem;

  .pending-title {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;

    .warn-icon {
      color: #8a6421;
      flex-shrink: 0;
      margin-top: 2px;
    }

    h2 {
      font-size: 1.05rem;
      color: var(--forest-green);
    }

    p {
      font-size: 0.8rem;
      color: var(--charcoal-soft);
      margin-top: 0.15rem;
    }
  }

  .pending-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .pending-item-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.65rem;
    flex-wrap: wrap;
    background: var(--bg-cream);
    border: 1px solid var(--charcoal-border);
    padding: 0.55rem 0.75rem;
    border-radius: 8px;
  }

  .pending-meta {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    font-size: 0.72rem;
    color: var(--charcoal-soft);
  }

  .status-pill.pending {
    background: var(--muted-gold-subtle);
    color: #8a6421;
    border: 1px solid var(--muted-gold);
    padding: 0.15rem 0.45rem;
    border-radius: 4px;
    font-weight: 700;
    font-size: 0.64rem;
  }

  .pending-actions {
    display: flex;
    gap: 0.4rem;
  }

  .btn-xs {
    padding: 0.35rem 0.65rem;
    font-size: 0.74rem;
    min-height: 32px;
  }
}

/* SEGMENTED TABS & SORT CONTROLS */
.segment-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.65rem;
  flex-wrap: wrap;
}

.segment-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.35rem;
  background: var(--bg-cream-muted);
  padding: 0.3rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--charcoal-border);
  flex: 1;
  min-width: 260px;
}

.seg-tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  min-height: 42px;
  padding: 0.5rem 0.75rem;
  border-radius: var(--radius-sm);
  font-size: 0.84rem;
  font-weight: 700;
  color: var(--charcoal-soft);
  transition: all 0.16s ease;

  &.active {
    background: var(--forest-green);
    color: var(--bg-cream);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
  }
}

.feed-controls {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.sort-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.5rem 0.75rem;
  border-radius: var(--radius-pill);
  background: var(--bg-cream-elevated);
  border: 1px solid var(--charcoal-border);
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--forest-green);

  &:hover:not(:disabled) {
    border-color: var(--forest-green);
  }
}

/* PHOTO CARDS GRID */
.contact-sheet-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 0.75rem;
}

.film-frame-card {
  padding: 0.5rem;
  background: #1b1d1c;
  color: var(--bg-cream);
  border-color: #2f3331;
  cursor: pointer;
}

.frame-top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.35rem;
  font-size: 0.65rem;
  color: var(--muted-gold-light);
  margin-bottom: 0.35rem;

  .guest-tag {
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .capture-time {
    display: inline-flex;
    align-items: center;
    gap: 0.22rem;
    color: #b5b0a6;
    flex-shrink: 0;
  }
}

.frame-img-wrap {
  width: 100%;
  aspect-ratio: 2 / 3;
  border-radius: 6px;
  overflow: hidden;
  background: #0d0f0e;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
}

.frame-bottom-bar {
  margin-top: 0.35rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.58rem;
  color: #9ca3af;

  .upload-badge.uploaded {
    color: #6ee7b7;
    font-weight: 700;
  }

  .hd-badge {
    padding: 0.1rem 0.35rem;
    border-radius: 4px;
    font-weight: 700;

    &.available {
      background: rgba(199, 166, 106, 0.2);
      color: var(--muted-gold-light);
    }

    &.missing {
      background: rgba(156, 163, 175, 0.15);
      color: #9ca3af;
    }
  }
}

.empty-roll-card {
  padding: 2.25rem 1.25rem;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.65rem;

  .empty-icon {
    width: 58px;
    height: 58px;
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
    font-size: 0.88rem;
    color: var(--charcoal-soft);
    margin-bottom: 0.25rem;
  }
}

/* LIGHTBOX */
.lightbox-backdrop {
  position: fixed;
  inset: 0;
  z-index: 250;
  background: rgba(12, 15, 14, 0.9);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.85rem;
}

.lightbox-modal {
  width: 100%;
  max-width: 440px;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.lightbox-header {
  display: flex;
  align-items: center;
  justify-content: space-between;

  .lb-time {
    font-size: 0.72rem;
    color: var(--charcoal-muted);
    margin-top: 0.2rem;
  }

  .close-btn {
    padding: 0.4rem;
    border-radius: 50%;
    background: var(--bg-cream-muted);
    color: var(--charcoal);
  }
}

.lb-version-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.25rem;
  background: var(--bg-cream-muted);
  padding: 0.25rem;
  border-radius: 8px;

  .lb-tab {
    font-size: 0.68rem;
    font-weight: 700;
    padding: 0.35rem 0.5rem;
    border-radius: 6px;
    color: var(--charcoal-soft);

    &.active {
      background: var(--forest-green);
      color: var(--bg-cream);
    }
  }
}

.lightbox-img-box {
  width: 100%;
  max-width: min(100%, calc(56dvh * 2 / 3));
  aspect-ratio: 2 / 3;
  margin: 0 auto;
  background: #101211;
  border-radius: 10px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
}

.lb-missing-hd-alert {
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
  padding: 0.55rem 0.7rem;
  border-radius: 8px;
  background: var(--muted-gold-subtle);
  border: 1px solid var(--muted-gold);
  color: #7c5819;
  font-size: 0.75rem;
}

.lightbox-actions {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.btn-block {
  width: 100%;
}

@media (max-width: 540px) {
  .summary-cta-group {
    width: 100%;
  }

  .btn-sm-block {
    width: 100%;
  }

  .feed-controls {
    width: 100%;
    justify-content: flex-end;
  }
}
</style>
