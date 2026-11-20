<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import QRCode from 'qrcode'
import {
  AlertTriangle,
  Archive,
  Camera,
  Check,
  Columns,
  Download,
  Eye,
  EyeOff,
  Film,
  Grid,
  LogOut,
  Maximize2,
  QrCode,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  Users,
  X
} from 'lucide-vue-next'
import { isFirebaseConfigured } from '../services/firebase'
import {
  deletePhotoForAdmin,
  fetchAllGuestsForAdmin,
  fetchAllPhotosForAdmin,
  isPhotoVisibleStatus,
  updatePhotoModerationStatus
} from '../services/repository'
import { getStorageProvider } from '../services/storageAdapter'
import {
  downloadEventPhotosAsZip,
  downloadSinglePhoto,
  triggerBlobDownload
} from '../services/zipExporter'
import { useSessionStore } from '../stores/sessionStore'
import type { AdminDashboardStats, Guest, PhotoRecord } from '../types'

const sessionStore = useSessionStore()
const router = useRouter()
const storageProvider = getStorageProvider()

type AdminTab = 'photos' | 'guests' | 'qrcode' | 'settings'
const activeTab = ref<AdminTab>('photos')

const guests = ref<Guest[]>([])
const photos = ref<PhotoRecord[]>([])
const isRefreshing = ref(false)
const feedbackMessage = ref('')
const errorBanner = ref('')

// --- Photo Gallery Filters & Layout ---
const galleryLayout = ref<'grid' | 'masonry'>('grid')
const photoGuestFilter = ref<string>('all')
const photoStatusFilter = ref<'all' | 'visible' | 'hidden'>('all')
const photoSortBy = ref<'latest' | 'oldest' | 'guest'>('latest')
const selectedPhotoModal = ref<PhotoRecord | null>(null)
const confirmDeletePhoto = ref<PhotoRecord | null>(null)
const deletingPhotoId = ref<string | null>(null)

// --- ZIP Export Options ---
const zipOptions = reactive({
  organizeByGuestFolder: true,
  includeTimestampInFilename: false,
  includeOriginals: false,
  exportHiddenToo: false
})
const isExportingZip = ref(false)
const zipProgress = reactive({ completed: 0, total: 0 })

// --- Guest Registration Filters ---
const guestSearchQuery = ref('')
const guestAttendanceFilter = ref<'all' | 'attending' | 'not_attending'>('all')
const selectedGuestModal = ref<Guest | null>(null)

// --- QR Code Generator ---
const customQrBaseUrl = ref(
  typeof window !== 'undefined' ? window.location.origin : 'https://xmas-roll.web.app'
)
const qrDataUrl = ref('')
const isFullscreenQrOpen = ref(false)

// --- Event Settings Form ---
const settingsForm = reactive({
  name: '',
  date: '',
  venue: '',
  description: '',
  registrationOpen: true,
  cameraEnabled: true,
  photoSubmissionOpen: true
})
const isSavingSettings = ref(false)

// ============================================================================
// COMPUTED DASHBOARD OVERVIEW METRICS
// ============================================================================
const dashboardStats = computed<AdminDashboardStats>(() => {
  const totalRegistrations = guests.value.length
  const confirmedAttendees = guests.value.filter((g) => g.attendance === 'attending').length
  const notAttending = guests.value.filter((g) => g.attendance === 'not_attending').length

  const totalPhotosSubmitted = photos.value.length
  const visiblePhotosCount = photos.value.filter((p) => isPhotoVisibleStatus(p.status)).length
  const hiddenPhotosCount = photos.value.filter((p) => p.status === 'hidden').length

  const totalShotsAllocated = guests.value.reduce((acc, g) => acc + (g.totalShots || 10), 0)
  const totalShotsUsed = guests.value.reduce((acc, g) => acc + (g.usedShots || 0), 0)
  const totalShotsRemaining = Math.max(0, totalShotsAllocated - totalShotsUsed)

  return {
    totalRegistrations,
    confirmedAttendees,
    notAttending,
    totalPhotosSubmitted,
    visiblePhotosCount,
    hiddenPhotosCount,
    totalShotsAllocated,
    totalShotsUsed,
    totalShotsRemaining
  }
})

// ============================================================================
// FILTERED GUESTS & PHOTOS
// ============================================================================
const filteredGuests = computed(() => {
  const q = guestSearchQuery.value.trim().toLowerCase()
  return guests.value.filter((g) => {
    if (guestAttendanceFilter.value !== 'all' && g.attendance !== guestAttendanceFilter.value) {
      return false
    }
    if (!q) return true
    return (
      g.fullName.toLowerCase().includes(q) ||
      g.department.toLowerCase().includes(q) ||
      g.email.toLowerCase().includes(q) ||
      g.contactNumber.toLowerCase().includes(q)
    )
  })
})

const filteredPhotos = computed(() => {
  const list = photos.value.filter((p) => {
    if (photoGuestFilter.value !== 'all' && p.guestId !== photoGuestFilter.value) {
      return false
    }
    if (photoStatusFilter.value === 'visible' && !isPhotoVisibleStatus(p.status)) {
      return false
    }
    if (photoStatusFilter.value === 'hidden' && p.status !== 'hidden') {
      return false
    }
    return true
  })

  return [...list].sort((a, b) => {
    if (photoSortBy.value === 'latest') {
      return b.capturedAt.localeCompare(a.capturedAt)
    }
    if (photoSortBy.value === 'oldest') {
      return a.capturedAt.localeCompare(b.capturedAt)
    }
    const nameCmp = a.guestName.localeCompare(b.guestName)
    return nameCmp !== 0 ? nameCmp : a.shotNumber - b.shotNumber
  })
})

const registrationTargetUrl = computed(() => {
  const cleanBase = customQrBaseUrl.value.trim().replace(/\/+$/, '')
  return `${cleanBase}/register`
})

// ============================================================================
// LIFECYCLE & DATA LOADING
// ============================================================================
onMounted(async () => {
  const admin = await sessionStore.hydrateAdminAuth()
  if (!admin?.isAdminVerified) {
    router.replace('/admin')
    return
  }
  await loadAllDashboardData()
  await generateRegistrationQrCode()
})

watch(registrationTargetUrl, () => {
  generateRegistrationQrCode()
})

function syncSettingsFormFromStore() {
  settingsForm.name = sessionStore.event.name
  settingsForm.date = sessionStore.event.date
  settingsForm.venue = sessionStore.event.venue
  settingsForm.description = sessionStore.event.description
  settingsForm.registrationOpen = sessionStore.event.registrationOpen
  settingsForm.cameraEnabled = sessionStore.event.cameraEnabled
  settingsForm.photoSubmissionOpen = sessionStore.event.photoSubmissionOpen
}

function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const msg = (err as { message?: unknown }).message
    if (typeof msg === 'string' && msg.trim().length > 0) return msg
  }
  return fallback
}

async function loadAllDashboardData() {
  isRefreshing.value = true
  errorBanner.value = ''
  try {
    await sessionStore.refreshEventSettings()
    syncSettingsFormFromStore()
    const [loadedGuests, loadedPhotos] = await Promise.all([
      fetchAllGuestsForAdmin(sessionStore.event.id),
      fetchAllPhotosForAdmin(sessionStore.event.id)
    ])
    guests.value = loadedGuests
    photos.value = loadedPhotos
  } catch (err: unknown) {
    errorBanner.value = extractErrorMessage(err, 'Failed to load dashboard data.')
  } finally {
    isRefreshing.value = false
  }
}

function showTransientToast(msg: string) {
  feedbackMessage.value = msg
  setTimeout(() => {
    if (feedbackMessage.value === msg) feedbackMessage.value = ''
  }, 4000)
}

// ============================================================================
// PHOTO MODERATION, DELETION & DOWNLOAD ACTIONS
// ============================================================================
async function handleTogglePhotoStatus(photo: PhotoRecord) {
  const nextStatus = isPhotoVisibleStatus(photo.status) ? 'hidden' : 'active'
  try {
    const updated = await updatePhotoModerationStatus(photo.id, nextStatus)
    const idx = photos.value.findIndex((p) => p.id === photo.id)
    if (idx !== -1) {
      photos.value[idx] = updated
    }
    if (selectedPhotoModal.value?.id === photo.id) {
      selectedPhotoModal.value = updated
    }
    showTransientToast(
      `Photo ${photo.filename} marked as ${nextStatus.toUpperCase()}.`
    )
  } catch (err: unknown) {
    errorBanner.value = extractErrorMessage(err, 'Could not update photo moderation status.')
  }
}

function requestDeletePhoto(photo: PhotoRecord) {
  confirmDeletePhoto.value = photo
}

function cancelDeletePhoto() {
  if (deletingPhotoId.value) return
  confirmDeletePhoto.value = null
}

async function handleDeletePhotoConfirmed() {
  const target = confirmDeletePhoto.value
  if (!target || deletingPhotoId.value) return

  deletingPhotoId.value = target.id
  errorBanner.value = ''
  try {
    await deletePhotoForAdmin(target.id)
    photos.value = photos.value.filter((p) => p.id !== target.id)
    if (selectedPhotoModal.value?.id === target.id) {
      selectedPhotoModal.value = null
    }
    confirmDeletePhoto.value = null
    showTransientToast(`Deleted photo ${target.filename}.`)
  } catch (err: unknown) {
    errorBanner.value = extractErrorMessage(err, 'Failed to delete photo.')
  } finally {
    deletingPhotoId.value = null
  }
}

async function handleDownloadSingle(photo: PhotoRecord) {
  try {
    const savedName = await downloadSinglePhoto(photo, {
      includeTimestamp: zipOptions.includeTimestampInFilename,
      useOriginal: false
    })
    showTransientToast(`Downloaded compressed photo ${savedName}`)
  } catch (err: unknown) {
    errorBanner.value = extractErrorMessage(err, 'Failed to download photo.')
  }
}

async function handleBulkZipExport() {
  const targetPhotos = filteredPhotos.value.filter(
    (p) => zipOptions.exportHiddenToo || isPhotoVisibleStatus(p.status)
  )

  if (!targetPhotos.length) {
    errorBanner.value = 'No visible photos match the current filter to export.'
    return
  }

  isExportingZip.value = true
  errorBanner.value = ''
  zipProgress.completed = 0
  zipProgress.total = targetPhotos.length

  try {
    const result = await downloadEventPhotosAsZip(targetPhotos, {
      organizeByGuestFolder: zipOptions.organizeByGuestFolder,
      includeTimestampInFilename: zipOptions.includeTimestampInFilename,
      includeOriginals: false,
      eventName: sessionStore.event.name,
      onProgress: (done, total) => {
        zipProgress.completed = done
        zipProgress.total = total
      }
    })
    showTransientToast(
      `Exported ${result.exportedCount} compressed photos into ZIP archive!`
    )
  } catch (err: unknown) {
    errorBanner.value = extractErrorMessage(err, 'Failed to export ZIP archive.')
  } finally {
    isExportingZip.value = false
  }
}

// ============================================================================
// QR CODE GENERATION & EXPORT
// ============================================================================
async function generateRegistrationQrCode() {
  try {
    qrDataUrl.value = await QRCode.toDataURL(registrationTargetUrl.value, {
      width: 640,
      margin: 2,
      color: {
        dark: '#183D32',
        light: '#FAF7F0'
      }
    })
  } catch (err) {
    console.error('QR generation failed:', err)
  }
}

async function handleDownloadQrPng() {
  if (!qrDataUrl.value) return
  const res = await fetch(qrDataUrl.value)
  const blob = await res.blob()
  triggerBlobDownload(blob, 'XMAS_ROLL_Registration_QR.png')
  showTransientToast('Downloaded XMAS_ROLL_Registration_QR.png')
}

// ============================================================================
// EVENT SETTINGS SAVE
// ============================================================================
async function handleSaveEventSettings() {
  isSavingSettings.value = true
  errorBanner.value = ''
  try {
    await sessionStore.saveEventConfiguration({
      name: settingsForm.name.trim(),
      date: settingsForm.date,
      venue: settingsForm.venue.trim(),
      description: settingsForm.description.trim(),
      registrationOpen: settingsForm.registrationOpen,
      cameraEnabled: settingsForm.cameraEnabled,
      photoSubmissionOpen: settingsForm.photoSubmissionOpen
    })
    showTransientToast('Event settings updated!')
  } catch (err: unknown) {
    errorBanner.value = extractErrorMessage(err, 'Failed to save event settings.')
  } finally {
    isSavingSettings.value = false
  }
}

function inspectGuestPhotos(guest: Guest) {
  selectedGuestModal.value = null
  photoGuestFilter.value = guest.id
  activeTab.value = 'photos'
}

function getGuestPhotosList(guestId: string): PhotoRecord[] {
  return photos.value
    .filter((p) => p.guestId === guestId)
    .sort((a, b) => a.shotNumber - b.shotNumber)
}

async function handleAdminLogout() {
  await sessionStore.logoutAdmin()
  router.push('/admin')
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}
</script>

<template>
  <div class="admin-dashboard">
    <!-- TOP BAR -->
    <header class="admin-topbar">
      <div class="topbar-inner">
        <div class="topbar-brand">
          <span class="badge badge-red">ORGANIZER CONSOLE</span>
          <h1 class="topbar-title">{{ sessionStore.event.name }}</h1>
        </div>

        <div class="topbar-actions">
          <span class="admin-email font-mono">
            <ShieldCheck :size="15" />
            {{ sessionStore.adminUser?.email }}
          </span>
          <button
            type="button"
            class="btn btn-outline btn-sm"
            :disabled="isRefreshing"
            @click="loadAllDashboardData"
          >
            <RefreshCw :size="15" />
            <span>Refresh</span>
          </button>
          <RouterLink to="/" class="btn btn-outline btn-sm">
            <Camera :size="15" />
            <span>Guest Site</span>
          </RouterLink>
          <button type="button" class="btn btn-red btn-sm" @click="handleAdminLogout">
            <LogOut :size="15" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </header>

    <div class="film-sprocket-bar" aria-hidden="true"></div>

    <main class="dashboard-main">
      <!-- STORAGE PROVIDER & INFRASTRUCTURE TRANSPARENCY BANNER -->
      <div
        v-if="!storageProvider.isPubliclyAccessible || !isFirebaseConfigured"
        class="dev-adapter-alert"
      >
        <AlertTriangle :size="17" class="alert-icon" />
        <span>
          <strong>Local Dev Mode:</strong> Using
          <u>{{ isFirebaseConfigured ? 'Firestore' : 'Local DB' }}</u> &amp;
          <u>{{ storageProvider.name.toUpperCase() }}</u> storage. Configure `.env` before live
          event.
        </span>
      </div>

      <!-- FEEDBACK TOAST / ERROR BANNER -->
      <div v-if="feedbackMessage" class="toast-banner" role="status">
        <Check :size="17" />
        <span>{{ feedbackMessage }}</span>
      </div>
      <div v-if="errorBanner" class="error-alert" role="alert">
        <AlertTriangle :size="17" />
        <span>{{ errorBanner }}</span>
        <button type="button" class="dismiss-btn" @click="errorBanner = ''">Dismiss</button>
      </div>

      <!-- OVERVIEW STATS ROW -->
      <section class="stats-grid" aria-label="Event Overview Metrics">
        <div class="stat-card retro-card">
          <span class="stat-label font-mono">TOTAL REGISTRATIONS</span>
          <strong class="stat-value" data-testid="stat-total-reg">
            {{ dashboardStats.totalRegistrations }}
          </strong>
          <span class="stat-sub">Registered guests</span>
        </div>

        <div class="stat-card retro-card">
          <span class="stat-label font-mono">CONFIRMED ATTENDEES</span>
          <strong class="stat-value green" data-testid="stat-attending">
            {{ dashboardStats.confirmedAttendees }}
          </strong>
          <span class="stat-sub">Attending party</span>
        </div>

        <div class="stat-card retro-card">
          <span class="stat-label font-mono">NOT ATTENDING</span>
          <strong class="stat-value muted" data-testid="stat-not-attending">
            {{ dashboardStats.notAttending }}
          </strong>
          <span class="stat-sub">RSVP regrets</span>
        </div>

        <div class="stat-card retro-card">
          <span class="stat-label font-mono">TOTAL PHOTOS SUBMITTED</span>
          <strong class="stat-value red" data-testid="stat-total-photos">
            {{ dashboardStats.totalPhotosSubmitted }}
          </strong>
          <span class="stat-sub">
            {{ dashboardStats.visiblePhotosCount }} visible ·
            {{ dashboardStats.hiddenPhotosCount }} hidden
          </span>
        </div>

        <div class="stat-card retro-card">
          <span class="stat-label font-mono">TOTAL SHOTS REMAINING</span>
          <strong class="stat-value gold" data-testid="stat-shots-remaining">
            {{ dashboardStats.totalShotsRemaining }}
          </strong>
          <span class="stat-sub">
            Out of {{ dashboardStats.totalShotsAllocated }} allocated exposures
          </span>
        </div>
      </section>

      <!-- MAIN NAVIGATION TABS -->
      <nav class="dashboard-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          class="dash-tab"
          :class="{ active: activeTab === 'photos' }"
          @click="activeTab = 'photos'"
        >
          <Film :size="16" />
          <span>Photos ({{ photos.length }})</span>
        </button>

        <button
          type="button"
          role="tab"
          class="dash-tab"
          :class="{ active: activeTab === 'guests' }"
          @click="activeTab = 'guests'"
        >
          <Users :size="16" />
          <span>Guests ({{ guests.length }})</span>
        </button>

        <button
          type="button"
          role="tab"
          class="dash-tab"
          :class="{ active: activeTab === 'qrcode' }"
          @click="activeTab = 'qrcode'"
        >
          <QrCode :size="16" />
          <span>QR Code</span>
        </button>

        <button
          type="button"
          role="tab"
          class="dash-tab"
          :class="{ active: activeTab === 'settings' }"
          @click="activeTab = 'settings'"
        >
          <Settings :size="16" />
          <span>Settings</span>
        </button>
      </nav>

      <!-- ===================================================================
           TAB 1: PHOTO GALLERY & BULK ZIP DOWNLOAD MANAGEMENT
           =================================================================== -->
      <section v-if="activeTab === 'photos'" class="tab-panel">
        <!-- Bulk ZIP Export Toolbar -->
        <div class="zip-export-card retro-card">
          <div class="zip-header">
            <div>
              <h2>Download Party Photos (Compressed Firestore Gallery)</h2>
              <p>
                Export all submitted compressed JPEG photos as a ZIP archive (`John_Doe_001.jpg`).
                Note: Uncompressed HD originals remain device-local on each guest’s browser.
              </p>
            </div>

            <button
              type="button"
              class="btn btn-red"
              :disabled="isExportingZip || filteredPhotos.length === 0"
              data-testid="export-zip-btn"
              @click="handleBulkZipExport"
            >
              <Archive :size="18" />
              <span>
                {{
                  isExportingZip
                    ? `Creating ZIP (${zipProgress.completed}/${zipProgress.total})...`
                    : `Download ZIP (${filteredPhotos.filter((p) => zipOptions.exportHiddenToo || isPhotoVisibleStatus(p.status)).length})`
                }}
              </span>
            </button>
          </div>

          <div class="zip-options-row">
            <label class="zip-check">
              <input v-model="zipOptions.organizeByGuestFolder" type="checkbox" />
              <span>Group by Guest Folder</span>
            </label>

            <label class="zip-check">
              <input v-model="zipOptions.includeTimestampInFilename" type="checkbox" />
              <span>Add Timestamp to Filename</span>
            </label>

            <label class="zip-check">
              <input v-model="zipOptions.exportHiddenToo" type="checkbox" />
              <span>Include Hidden / Moderated Photos</span>
            </label>
          </div>
        </div>

        <!-- Gallery Filter & Layout Controls -->
        <div class="gallery-toolbar retro-card">
          <div class="filter-controls">
            <div class="control-item">
              <label class="font-mono" for="filterGuest">GUEST</label>
              <select id="filterGuest" v-model="photoGuestFilter" class="form-input compact">
                <option value="all">All Guests ({{ guests.length }})</option>
                <option v-for="g in guests" :key="g.id" :value="g.id">
                  {{ g.fullName }} ({{ g.usedShots }}/10)
                </option>
              </select>
            </div>

            <div class="control-item">
              <label class="font-mono" for="filterStatus">STATUS</label>
              <select id="filterStatus" v-model="photoStatusFilter" class="form-input compact">
                <option value="all">All Photos</option>
                <option value="visible">Visible Only</option>
                <option value="hidden">Hidden / Moderated</option>
              </select>
            </div>

            <div class="control-item">
              <label class="font-mono" for="sortPhotos">SORT BY</label>
              <select id="sortPhotos" v-model="photoSortBy" class="form-input compact">
                <option value="latest">Latest Captured</option>
                <option value="oldest">Oldest First</option>
                <option value="guest">Guest Name (A–Z)</option>
              </select>
            </div>
          </div>

          <div class="layout-toggle" role="group" aria-label="Gallery layout">
            <button
              type="button"
              class="layout-btn"
              :class="{ active: galleryLayout === 'grid' }"
              title="Uniform Grid Layout"
              @click="galleryLayout = 'grid'"
            >
              <Grid :size="17" />
              <span>Grid</span>
            </button>
            <button
              type="button"
              class="layout-btn"
              :class="{ active: galleryLayout === 'masonry' }"
              title="Masonry Layout"
              @click="galleryLayout = 'masonry'"
            >
              <Columns :size="17" />
              <span>Masonry</span>
            </button>
          </div>
        </div>

        <!-- Photo Cards -->
        <div
          v-if="filteredPhotos.length > 0"
          :class="galleryLayout === 'masonry' ? 'admin-photo-masonry' : 'admin-photo-grid'"
        >
          <article
            v-for="photo in filteredPhotos"
            :key="photo.id"
            class="admin-photo-card retro-card"
            :class="{ moderated: photo.status === 'hidden' }"
          >
            <div class="photo-card-top font-mono">
              <span class="shot-pill">#{{ String(photo.shotNumber).padStart(2, '0') }}/10</span>
              <span class="file-label" :title="photo.filename">{{ photo.filename }}</span>
              <span
                class="status-dot"
                :class="isPhotoVisibleStatus(photo.status) ? 'visible' : 'hidden'"
              >
                {{ photo.status }}
              </span>
            </div>

            <div
              class="photo-thumb-box"
              @click="selectedPhotoModal = photo"
            >
              <img :src="photo.compressedImage || photo.imageUrl" :alt="photo.filename" loading="lazy" />
            </div>

            <div class="photo-card-meta">
              <div>
                <strong class="guest-title">{{ photo.guestName }}</strong>
                <span class="meta-time font-mono">
                  {{ formatDateTime(photo.capturedAt) }} · {{ photo.department }}
                </span>
              </div>

              <div class="card-btn-row">
                <button
                  type="button"
                  class="icon-action-btn"
                  title="Download Compressed Photo"
                  @click="handleDownloadSingle(photo)"
                >
                  <Download :size="16" />
                </button>
                <button
                  type="button"
                  class="icon-action-btn"
                  :class="{ warn: isPhotoVisibleStatus(photo.status) }"
                  :title="
                    isPhotoVisibleStatus(photo.status)
                      ? 'Hide photo from slideshow'
                      : 'Restore photo to gallery'
                  "
                  @click="handleTogglePhotoStatus(photo)"
                >
                  <EyeOff v-if="isPhotoVisibleStatus(photo.status)" :size="16" />
                  <Eye v-else :size="16" />
                </button>
                <button
                  type="button"
                  class="icon-action-btn danger"
                  title="Delete photo permanently"
                  aria-label="Delete photo permanently"
                  data-testid="delete-photo-btn"
                  :disabled="deletingPhotoId === photo.id"
                  @click="requestDeletePhoto(photo)"
                >
                  <Trash2 :size="16" />
                </button>
              </div>
            </div>
          </article>
        </div>

        <div v-else class="empty-state retro-card">
          <Film :size="34" />
          <h3>No Photos Match Current Filter</h3>
          <p>When guests capture and develop exposures, they appear here in real time.</p>
        </div>
      </section>

      <!-- ===================================================================
           TAB 2: GUEST REGISTRATION MANAGEMENT
           =================================================================== -->
      <section v-if="activeTab === 'guests'" class="tab-panel">
        <div class="guest-toolbar retro-card">
          <div class="search-box">
            <Search :size="18" class="search-icon" />
            <input
              v-model="guestSearchQuery"
              type="search"
              class="form-input search-input"
              placeholder="Search guest by name, department, email, or phone..."
            />
          </div>

          <div class="attendance-filter">
            <button
              type="button"
              class="filter-pill"
              :class="{ active: guestAttendanceFilter === 'all' }"
              @click="guestAttendanceFilter = 'all'"
            >
              All ({{ guests.length }})
            </button>
            <button
              type="button"
              class="filter-pill"
              :class="{ active: guestAttendanceFilter === 'attending' }"
              @click="guestAttendanceFilter = 'attending'"
            >
              Attending ({{ dashboardStats.confirmedAttendees }})
            </button>
            <button
              type="button"
              class="filter-pill"
              :class="{ active: guestAttendanceFilter === 'not_attending' }"
              @click="guestAttendanceFilter = 'not_attending'"
            >
              Not Attending ({{ dashboardStats.notAttending }})
            </button>
          </div>
        </div>

        <div v-if="filteredGuests.length > 0" class="guest-table-wrapper retro-card">
          <table class="guest-table">
            <thead>
              <tr>
                <th>Guest Name</th>
                <th>Department / Team</th>
                <th>Attendance</th>
                <th>Contact Details</th>
                <th>Camera Usage</th>
                <th>Registered</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="g in filteredGuests" :key="g.id">
                <td>
                  <strong class="g-name">{{ g.fullName }}</strong>
                  <span class="g-id font-mono">ID: {{ g.id }}</span>
                </td>
                <td>{{ g.department || '—' }}</td>
                <td>
                  <span
                    class="badge"
                    :class="g.attendance === 'attending' ? 'badge-green' : 'badge-red'"
                  >
                    {{ g.attendance === 'attending' ? 'Attending' : 'Not Attending' }}
                  </span>
                </td>
                <td>
                  <div class="contact-cell font-mono">
                    <span v-if="g.contactNumber">{{ g.contactNumber }}</span>
                    <span v-if="g.email">{{ g.email }}</span>
                    <span v-if="!g.contactNumber && !g.email" class="muted">—</span>
                  </div>
                </td>
                <td>
                  <div class="usage-cell">
                    <div class="usage-top font-mono">
                      <span>{{ g.usedShots }} / {{ g.totalShots }} SHOTS</span>
                      <span>{{ g.totalShots - g.usedShots }} left</span>
                    </div>
                    <div class="usage-bar">
                      <div
                        class="usage-fill"
                        :style="{ width: `${Math.min(100, (g.usedShots / g.totalShots) * 100)}%` }"
                      ></div>
                    </div>
                  </div>
                </td>
                <td class="font-mono small-cell">{{ formatDateTime(g.createdAt) }}</td>
                <td>
                  <div class="table-actions">
                    <button
                      type="button"
                      class="btn btn-outline btn-xs"
                      @click="selectedGuestModal = g"
                    >
                      Details
                    </button>
                    <button
                      type="button"
                      class="btn btn-primary btn-xs"
                      @click="inspectGuestPhotos(g)"
                    >
                      Photos ({{ g.usedShots }})
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-else class="empty-state retro-card">
          <Users :size="34" />
          <h3>No Matching Guests</h3>
          <p>Share the registration QR code so guests can register and claim their 10 shots.</p>
        </div>
      </section>

      <!-- ===================================================================
           TAB 3: QR CODE MANAGEMENT
           =================================================================== -->
      <section v-if="activeTab === 'qrcode'" class="tab-panel">
        <div class="qr-management-grid">
          <div class="qr-config-card retro-card">
            <span class="badge badge-gold">EVENT ENTRANCE ACCESS</span>
            <h2>Guest Registration QR Code</h2>
            <p>
              Print this QR code on table tents or display it on the venue welcome screen. Scanning
              it takes guests directly to the XMAS ROLL registration page.
            </p>

            <div class="form-group">
              <label for="qrBaseUrl" class="form-label">Website Base URL</label>
              <input
                id="qrBaseUrl"
                v-model="customQrBaseUrl"
                type="url"
                class="form-input font-mono"
                placeholder="https://your-project.web.app"
              />
            </div>

            <div class="target-url-preview font-mono">
              <span>TARGET URL:</span>
              <strong>{{ registrationTargetUrl }}</strong>
            </div>

            <div class="qr-action-buttons">
              <button type="button" class="btn btn-primary" @click="handleDownloadQrPng">
                <Download :size="18" />
                <span>Download QR Code PNG</span>
              </button>

              <button
                type="button"
                class="btn btn-red"
                @click="isFullscreenQrOpen = true"
              >
                <Maximize2 :size="18" />
                <span>Display Fullscreen Poster</span>
              </button>
            </div>
          </div>

          <div class="qr-poster-preview retro-card">
            <div class="poster-inner">
              <span class="poster-kicker font-mono">35MM DISPOSABLE CAMERA</span>
              <h3>{{ sessionStore.event.name }}</h3>
              <p class="poster-tagline">“One night. One camera. A thousand memories.”</p>
              <div class="qr-frame">
                <img v-if="qrDataUrl" :src="qrDataUrl" alt="Registration QR Code" />
              </div>
              <span class="poster-cta font-mono">SCAN TO CLAIM YOUR 10 SHOTS</span>
            </div>
          </div>
        </div>
      </section>

      <!-- ===================================================================
           TAB 4: EVENT SETTINGS
           =================================================================== -->
      <section v-if="activeTab === 'settings'" class="tab-panel">
        <form class="settings-card retro-card" @submit.prevent="handleSaveEventSettings">
          <div class="settings-header">
            <div>
              <span class="badge badge-green">EVENT CONTROLS</span>
              <h2>Event Settings &amp; Availability</h2>
            </div>
            <button type="submit" class="btn btn-primary" :disabled="isSavingSettings">
              <Check :size="18" />
              <span>{{ isSavingSettings ? 'Saving...' : 'Save Event Settings' }}</span>
            </button>
          </div>

          <div class="settings-switches">
            <label class="switch-card">
              <div>
                <strong>Guest Registration Open</strong>
                <p>Allow new guests to register through the QR code and receive 10 shots.</p>
              </div>
              <input v-model="settingsForm.registrationOpen" type="checkbox" class="toggle-box" />
            </label>

            <label class="switch-card">
              <div>
                <strong>Disposable Camera Enabled</strong>
                <p>Allow registered guests to open the live viewfinder and snap photos.</p>
              </div>
              <input v-model="settingsForm.cameraEnabled" type="checkbox" class="toggle-box" />
            </label>

            <label class="switch-card">
              <div>
                <strong>Photo Submission Open</strong>
                <p>Allow guests to upload and develop captured photos into the party gallery.</p>
              </div>
              <input v-model="settingsForm.photoSubmissionOpen" type="checkbox" class="toggle-box" />
            </label>
          </div>

          <div class="form-row-2">
            <div class="form-group">
              <label for="evName" class="form-label">Event Name</label>
              <input
                id="evName"
                v-model="settingsForm.name"
                type="text"
                class="form-input"
                required
              />
            </div>

            <div class="form-group">
              <label for="evDate" class="form-label">Event Date &amp; Time</label>
              <input
                id="evDate"
                v-model="settingsForm.date"
                type="datetime-local"
                class="form-input"
                required
              />
            </div>
          </div>

          <div class="form-group">
            <label for="evVenue" class="form-label">Event Venue</label>
            <input
              id="evVenue"
              v-model="settingsForm.venue"
              type="text"
              class="form-input"
              required
            />
          </div>

          <div class="form-group">
            <label for="evDesc" class="form-label">Event Description</label>
            <textarea
              id="evDesc"
              v-model="settingsForm.description"
              rows="3"
              class="form-input"
              required
            ></textarea>
          </div>
        </form>
      </section>
    </main>

    <!-- =====================================================================
         INDIVIDUAL PHOTO INSPECTION MODAL
         ===================================================================== -->
    <Transition name="fade">
      <div
        v-if="selectedPhotoModal"
        class="modal-backdrop"
        role="dialog"
        aria-modal="true"
        @click.self="selectedPhotoModal = null"
      >
        <div class="photo-detail-modal retro-card">
          <div class="modal-top">
            <div>
              <span class="badge badge-gold">
                SHOT #{{ selectedPhotoModal.shotNumber }} · {{ selectedPhotoModal.guestName }}
              </span>
              <h3>{{ selectedPhotoModal.filename }}</h3>
              <p class="font-mono sub-meta">
                Captured: {{ formatDateTime(selectedPhotoModal.capturedAt) }} ·
                {{ selectedPhotoModal.width }}×{{ selectedPhotoModal.height }}px ·
                {{ Math.max(1, Math.round((selectedPhotoModal.sizeBytes || 0) / 1024)) }} KB ·
                {{ selectedPhotoModal.imageFormat || 'image/jpeg' }} (75% Firestore Compressed)
              </p>
            </div>
            <button type="button" class="close-btn" @click="selectedPhotoModal = null">
              <X :size="20" />
            </button>
          </div>

          <div class="modal-img-stage">
            <img
              :src="selectedPhotoModal.compressedImage || selectedPhotoModal.imageUrl"
              :alt="selectedPhotoModal.filename"
            />
          </div>

          <div class="modal-actions">
            <button
              type="button"
              class="btn btn-outline"
              @click="handleTogglePhotoStatus(selectedPhotoModal)"
            >
              <EyeOff v-if="isPhotoVisibleStatus(selectedPhotoModal.status)" :size="17" />
              <Eye v-else :size="17" />
              <span>
                {{
                  isPhotoVisibleStatus(selectedPhotoModal.status)
                    ? 'Hide from Gallery'
                    : 'Restore to Gallery'
                }}
              </span>
            </button>

            <button
              type="button"
              class="btn btn-primary"
              @click="handleDownloadSingle(selectedPhotoModal)"
            >
              <Download :size="17" />
              <span>Download (JPEG)</span>
            </button>

            <button
              type="button"
              class="btn btn-red"
              data-testid="modal-delete-photo-btn"
              :disabled="deletingPhotoId === selectedPhotoModal.id"
              @click="requestDeletePhoto(selectedPhotoModal)"
            >
              <Trash2 :size="17" />
              <span>Delete Photo</span>
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- =====================================================================
         CONFIRM DELETE PHOTO MODAL
         ===================================================================== -->
    <Transition name="fade">
      <div
        v-if="confirmDeletePhoto"
        class="modal-backdrop delete-confirm-backdrop"
        role="dialog"
        aria-modal="true"
        aria-label="Confirm photo deletion"
        @click.self="cancelDeletePhoto"
      >
        <div class="confirm-delete-modal retro-card">
          <div class="confirm-delete-head">
            <div class="danger-icon-badge">
              <Trash2 :size="20" />
            </div>
            <div>
              <h3>Delete Photo Permanently?</h3>
              <p>This removes the photo from the event gallery and cannot be undone.</p>
            </div>
          </div>

          <div class="confirm-delete-preview">
            <img
              :src="confirmDeletePhoto.compressedImage || confirmDeletePhoto.imageUrl"
              :alt="confirmDeletePhoto.filename"
            />
            <div class="confirm-delete-meta">
              <strong>{{ confirmDeletePhoto.guestName }}</strong>
              <span class="font-mono">{{ confirmDeletePhoto.filename }}</span>
              <span class="font-mono">{{ formatDateTime(confirmDeletePhoto.capturedAt) }}</span>
            </div>
          </div>

          <div class="confirm-delete-actions">
            <button
              type="button"
              class="btn btn-outline"
              :disabled="Boolean(deletingPhotoId)"
              @click="confirmDeletePhoto = null"
            >
              <span>Cancel</span>
            </button>
            <button
              type="button"
              class="btn btn-red"
              data-testid="confirm-delete-photo-btn"
              :disabled="Boolean(deletingPhotoId)"
              @click="handleDeletePhotoConfirmed"
            >
              <Trash2 :size="16" />
              <span>{{ deletingPhotoId ? 'Deleting...' : 'Delete Permanently' }}</span>
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- =====================================================================
         GUEST DETAILS MODAL
         ===================================================================== -->
    <Transition name="fade">
      <div
        v-if="selectedGuestModal"
        class="modal-backdrop"
        role="dialog"
        aria-modal="true"
        @click.self="selectedGuestModal = null"
      >
        <div class="guest-detail-modal retro-card">
          <div class="modal-top">
            <div>
              <span class="badge badge-green">GUEST REGISTRATION RECORD</span>
              <h3>{{ selectedGuestModal.fullName }}</h3>
              <p class="font-mono sub-meta">
                Session ID: {{ selectedGuestModal.cameraSessionId }}
              </p>
            </div>
            <button type="button" class="close-btn" @click="selectedGuestModal = null">
              <X :size="20" />
            </button>
          </div>

          <div class="guest-info-grid">
            <div>
              <span class="info-label font-mono">DEPARTMENT</span>
              <strong>{{ selectedGuestModal.department }}</strong>
            </div>
            <div>
              <span class="info-label font-mono">ATTENDANCE</span>
              <strong>
                {{
                  selectedGuestModal.attendance === 'attending'
                    ? 'Confirmed Attending'
                    : 'Not Attending'
                }}
              </strong>
            </div>
            <div>
              <span class="info-label font-mono">CONTACT NUMBER</span>
              <strong>{{ selectedGuestModal.contactNumber || 'Not provided' }}</strong>
            </div>
            <div>
              <span class="info-label font-mono">EMAIL ADDRESS</span>
              <strong>{{ selectedGuestModal.email || 'Not provided' }}</strong>
            </div>
            <div>
              <span class="info-label font-mono">SHOTS CONSUMED</span>
              <strong>
                {{ selectedGuestModal.usedShots }} / {{ selectedGuestModal.totalShots }}
              </strong>
            </div>
            <div>
              <span class="info-label font-mono">SHOTS REMAINING</span>
              <strong>
                {{ selectedGuestModal.totalShots - selectedGuestModal.usedShots }}
              </strong>
            </div>
          </div>

          <div class="guest-mini-strip">
            <h4 class="font-mono">SUBMITTED FRAMES ({{ getGuestPhotosList(selectedGuestModal.id).length }})</h4>
            <div
              v-if="getGuestPhotosList(selectedGuestModal.id).length > 0"
              class="mini-thumb-row"
            >
              <img
                v-for="p in getGuestPhotosList(selectedGuestModal.id)"
                :key="p.id"
                :src="p.imageUrl"
                :alt="p.filename"
                class="mini-thumb"
                @click="
                  selectedGuestModal = null;
                  selectedPhotoModal = p
                "
              />
            </div>
            <p v-else class="muted-note">No photos uploaded by this guest yet.</p>
          </div>
        </div>
      </div>
    </Transition>

    <!-- =====================================================================
         FULLSCREEN QR DISPLAY POSTER MODAL
         ===================================================================== -->
    <Transition name="fade">
      <div
        v-if="isFullscreenQrOpen"
        class="fullscreen-qr-modal"
        role="dialog"
        aria-modal="true"
        @click.self="isFullscreenQrOpen = false"
      >
        <div class="fullscreen-poster retro-card">
          <button
            type="button"
            class="close-poster-btn"
            aria-label="Close Fullscreen QR"
            @click="isFullscreenQrOpen = false"
          >
            <X :size="22" />
          </button>

          <span class="badge badge-red">35MM DIGITAL DISPOSABLE CAMERA</span>
          <h1>{{ sessionStore.event.name }}</h1>
          <p class="fs-tagline">“One night. One camera. A thousand memories.”</p>

          <div class="fs-qr-box">
            <img v-if="qrDataUrl" :src="qrDataUrl" alt="Scan to Register" />
          </div>

          <div class="fs-instructions">
            <strong>1. Scan QR Code · 2. Register Name · 3. Snap 10 Film Shots</strong>
            <span class="font-mono">{{ registrationTargetUrl }}</span>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped lang="scss">
.admin-dashboard {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.admin-topbar {
  background: var(--forest-green-dark);
  color: var(--bg-cream);
  padding: 0.85rem 1.25rem;
}

.topbar-inner {
  max-width: 1240px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.topbar-brand {
  display: flex;
  align-items: center;
  gap: 0.75rem;

  .topbar-title {
    font-size: 1.35rem;
    color: var(--bg-cream);
  }
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  flex-wrap: wrap;

  .admin-email {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.75rem;
    color: var(--muted-gold-light);
    margin-right: 0.35rem;
  }
}

.btn-sm {
  padding: 0.48rem 0.9rem;
  font-size: 0.8rem;
}

.btn-xs {
  padding: 0.32rem 0.68rem;
  font-size: 0.75rem;
}

.dashboard-main {
  flex: 1;
  max-width: 1240px;
  width: 100%;
  margin: 0 auto;
  padding: 1.75rem 1.25rem 3.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.4rem;
}

.dev-adapter-alert {
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
  padding: 0.85rem 1.1rem;
  border-radius: var(--radius-md);
  background: var(--muted-gold-subtle);
  border: 1px solid var(--muted-gold);
  font-size: 0.84rem;
  color: var(--charcoal);

  .alert-icon {
    color: #8a6421;
    flex-shrink: 0;
    margin-top: 2px;
  }
}

.toast-banner {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.8rem 1.1rem;
  border-radius: var(--radius-md);
  background: var(--forest-green);
  color: var(--bg-cream);
  font-weight: 600;
  font-size: 0.88rem;
}

.error-alert {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.85rem 1.1rem;
  border-radius: var(--radius-md);
  background: var(--xmas-red-subtle);
  border: 1px solid rgba(181, 59, 53, 0.35);
  color: var(--xmas-red-dark);
  font-size: 0.88rem;

  .dismiss-btn {
    margin-left: auto;
    font-weight: 700;
    text-decoration: underline;
    color: inherit;
  }
}

/* OVERVIEW STATS */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 1rem;
}

.stat-card {
  padding: 1.15rem 1.2rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;

  .stat-label {
    font-size: 0.66rem;
    color: var(--charcoal-muted);
    letter-spacing: 0.06em;
  }

  .stat-value {
    font-family: var(--font-display);
    font-size: 2rem;
    color: var(--charcoal);
    line-height: 1.1;

    &.green {
      color: var(--forest-green);
    }
    &.red {
      color: var(--xmas-red);
    }
    &.gold {
      color: #8a6421;
    }
    &.muted {
      color: var(--charcoal-muted);
    }
  }

  .stat-sub {
    font-size: 0.76rem;
    color: var(--charcoal-muted);
  }
}

/* TABS */
.dashboard-tabs {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  border-bottom: 1.5px solid var(--charcoal-border);
  padding-bottom: 0.75rem;
}

.dash-tab {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.68rem 1.15rem;
  border-radius: var(--radius-pill);
  font-weight: 700;
  font-size: 0.88rem;
  color: var(--charcoal-soft);
  background: var(--bg-cream-elevated);
  border: 1px solid var(--charcoal-border);
  transition: all 0.16s ease;

  &.active {
    background: var(--forest-green);
    color: var(--bg-cream);
    border-color: var(--forest-green-dark);
  }
}

.tab-panel {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

/* ZIP EXPORT CARD */
.zip-export-card {
  padding: 1.45rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  border-left: 5px solid var(--xmas-red);
}

.zip-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;

  h2 {
    font-size: 1.35rem;
    color: var(--forest-green);
    margin: 0.3rem 0 0.2rem;
  }

  p {
    font-size: 0.88rem;
    color: var(--charcoal-soft);
  }
}

.zip-options-row {
  display: flex;
  flex-wrap: wrap;
  gap: 1.25rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--charcoal-border);
}

.zip-check {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.84rem;
  color: var(--charcoal-soft);
  cursor: pointer;

  input {
    width: 16px;
    height: 16px;
    accent-color: var(--forest-green);
  }
}

/* GALLERY TOOLBAR */
.gallery-toolbar {
  padding: 1rem 1.25rem;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.filter-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 0.85rem;
}

.control-item {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;

  label {
    font-size: 0.65rem;
    font-weight: 700;
    color: var(--charcoal-muted);
  }

  .compact {
    padding: 0.5rem 0.75rem;
    font-size: 0.85rem;
    min-width: 170px;
  }
}

.layout-toggle {
  display: flex;
  background: var(--bg-cream-muted);
  padding: 0.25rem;
  border-radius: 10px;
  gap: 0.25rem;
}

.layout-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.42rem 0.75rem;
  border-radius: 7px;
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--charcoal-soft);

  &.active {
    background: var(--forest-green);
    color: var(--bg-cream);
  }
}

/* PHOTO GRID & MASONRY */
.admin-photo-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 1.15rem;
}

.admin-photo-masonry {
  columns: 4 250px;
  column-gap: 1.15rem;

  .admin-photo-card {
    break-inside: avoid;
    margin-bottom: 1.15rem;
  }
}

.admin-photo-card {
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;

  &.moderated {
    opacity: 0.55;
    background: var(--bg-cream-muted);
  }
}

.photo-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
  font-size: 0.68rem;

  .shot-pill {
    background: var(--charcoal);
    color: var(--muted-gold-light);
    padding: 0.15rem 0.45rem;
    border-radius: 4px;
    font-weight: 700;
  }

  .file-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--charcoal-soft);
  }

  .status-dot {
    text-transform: uppercase;
    font-weight: 700;
    &.visible {
      color: var(--forest-green);
    }
    &.hidden {
      color: var(--xmas-red);
    }
  }
}

.photo-thumb-box {
  width: 100%;
  aspect-ratio: 2 / 3;
  background: #101211;
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transition: transform 0.2s ease;
  }

  &:hover img {
    transform: scale(1.02);
  }
}

.photo-card-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;

  .guest-title {
    display: block;
    font-size: 0.88rem;
    color: var(--charcoal);
  }

  .meta-time {
    display: block;
    font-size: 0.65rem;
    color: var(--charcoal-muted);
  }
}

.card-btn-row {
  display: flex;
  gap: 0.35rem;
}

.icon-action-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--bg-cream);
  border: 1px solid var(--charcoal-border);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--forest-green);

  &:hover {
    background: var(--forest-green);
    color: var(--bg-cream);
  }

  &.warn:hover {
    background: var(--xmas-red);
    color: var(--bg-cream);
  }

  &.danger {
    color: var(--xmas-red);

    &:hover:not(:disabled) {
      background: var(--xmas-red);
      color: var(--bg-cream);
      border-color: var(--xmas-red-dark);
    }
  }
}

/* GUEST MANAGEMENT TABLE */
.guest-toolbar {
  padding: 1rem 1.2rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.search-box {
  position: relative;
  flex: 1;
  min-width: 240px;

  .search-icon {
    position: absolute;
    left: 12px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--charcoal-muted);
  }

  .search-input {
    padding-left: 2.35rem;
  }
}

.attendance-filter {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.filter-pill {
  padding: 0.48rem 0.9rem;
  border-radius: var(--radius-pill);
  font-size: 0.8rem;
  font-weight: 700;
  background: var(--bg-cream);
  border: 1px solid var(--charcoal-border);
  color: var(--charcoal-soft);

  &.active {
    background: var(--forest-green);
    color: var(--bg-cream);
  }
}

.guest-table-wrapper {
  overflow-x: auto;
}

.guest-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;

  th,
  td {
    padding: 0.9rem 1rem;
    text-align: left;
    border-bottom: 1px solid var(--charcoal-border);
  }

  th {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--charcoal-muted);
    background: rgba(234, 226, 211, 0.45);
  }

  .g-name {
    display: block;
    color: var(--forest-green);
  }

  .g-id {
    font-size: 0.66rem;
    color: var(--charcoal-muted);
  }
}

.contact-cell {
  display: flex;
  flex-direction: column;
  font-size: 0.74rem;
}

.usage-cell {
  min-width: 135px;

  .usage-top {
    display: flex;
    justify-content: space-between;
    font-size: 0.68rem;
    margin-bottom: 4px;
  }

  .usage-bar {
    height: 7px;
    border-radius: 99px;
    background: var(--bg-cream-deep);
    overflow: hidden;
  }

  .usage-fill {
    height: 100%;
    background: var(--xmas-red);
    border-radius: 99px;
  }
}

.table-actions {
  display: flex;
  gap: 0.4rem;
}

/* QR CODE MANAGEMENT */
.qr-management-grid {
  display: grid;
  grid-template-columns: 1.1fr 0.9fr;
  gap: 1.5rem;
  align-items: start;
}

.qr-config-card {
  padding: 1.65rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;

  h2 {
    color: var(--forest-green);
  }

  p {
    color: var(--charcoal-soft);
    font-size: 0.92rem;
  }
}

.target-url-preview {
  padding: 0.75rem 1rem;
  background: var(--bg-cream);
  border: 1px dashed var(--charcoal-border);
  border-radius: var(--radius-md);
  font-size: 0.78rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  word-break: break-all;
}

.qr-action-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.qr-poster-preview {
  padding: 1.75rem;
  background: var(--forest-green);
  color: var(--bg-cream);
  text-align: center;
}

.poster-inner {
  border: 2px solid var(--muted-gold);
  border-radius: var(--radius-md);
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.65rem;

  .poster-kicker {
    font-size: 0.68rem;
    color: var(--muted-gold-light);
    letter-spacing: 0.08em;
  }

  h3 {
    font-size: 1.5rem;
  }

  .poster-tagline {
    font-style: italic;
    font-size: 0.88rem;
    opacity: 0.9;
  }

  .qr-frame {
    background: #faf7f0;
    padding: 0.75rem;
    border-radius: 14px;
    margin: 0.5rem 0;

    img {
      width: 210px;
      height: 210px;
      display: block;
    }
  }

  .poster-cta {
    background: var(--xmas-red);
    color: var(--bg-cream);
    padding: 0.35rem 0.85rem;
    border-radius: var(--radius-pill);
    font-size: 0.74rem;
    font-weight: 700;
  }
}

/* EVENT SETTINGS */
.settings-card {
  padding: 1.75rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;

  h2 {
    color: var(--forest-green);
    margin-top: 0.3rem;
  }
}

.settings-switches {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
}

.switch-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem;
  background: var(--bg-cream);
  border: 1.5px solid var(--charcoal-border);
  border-radius: var(--radius-md);
  cursor: pointer;

  strong {
    display: block;
    font-size: 0.92rem;
    color: var(--forest-green);
    margin-bottom: 0.2rem;
  }

  p {
    font-size: 0.78rem;
    color: var(--charcoal-soft);
  }

  .toggle-box {
    width: 22px;
    height: 22px;
    accent-color: var(--forest-green);
    flex-shrink: 0;
  }
}

.form-row-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

.empty-state {
  padding: 3rem 1.5rem;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
  color: var(--charcoal-muted);

  h3 {
    color: var(--forest-green);
  }
}

/* MODALS */
.modal-backdrop,
.fullscreen-qr-modal {
  position: fixed;
  inset: 0;
  z-index: 300;
  background: rgba(12, 15, 14, 0.88);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.delete-confirm-backdrop {
  z-index: 350;
}

.confirm-delete-modal {
  width: 100%;
  max-width: 420px;
  padding: 1.35rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  border-top: 4px solid var(--xmas-red);
}

.confirm-delete-head {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;

  .danger-icon-badge {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    background: var(--xmas-red-subtle);
    color: var(--xmas-red);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  h3 {
    font-size: 1.15rem;
    color: var(--charcoal);
  }

  p {
    font-size: 0.84rem;
    color: var(--charcoal-muted);
    margin-top: 0.15rem;
  }
}

.confirm-delete-preview {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  padding: 0.65rem;
  background: var(--bg-cream);
  border: 1px solid var(--charcoal-border);
  border-radius: var(--radius-md);

  img {
    width: 54px;
    height: 81px;
    object-fit: cover;
    border-radius: 6px;
    flex-shrink: 0;
    background: #101211;
  }
}

.confirm-delete-meta {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;

  strong {
    font-size: 0.92rem;
    color: var(--forest-green);
  }

  span {
    font-size: 0.72rem;
    color: var(--charcoal-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.confirm-delete-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
}

.photo-detail-modal,
.guest-detail-modal {
  width: 100%;
  max-width: 540px;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.modal-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;

  h3 {
    color: var(--forest-green);
    margin-top: 0.25rem;
  }

  .sub-meta {
    font-size: 0.72rem;
    color: var(--charcoal-muted);
  }

  .close-btn {
    padding: 0.4rem;
    border-radius: 50%;
    background: var(--bg-cream-muted);
  }
}

.version-switch {
  display: flex;
  gap: 0.4rem;
  background: var(--bg-cream-muted);
  padding: 0.25rem;
  border-radius: 8px;
  align-self: flex-start;

  .ver-btn {
    font-size: 0.72rem;
    font-weight: 700;
    padding: 0.35rem 0.75rem;
    border-radius: 6px;

    &.active {
      background: var(--forest-green);
      color: var(--bg-cream);
    }
  }
}

.modal-img-stage {
  width: 100%;
  max-width: min(100%, calc(60vh * 2 / 3));
  aspect-ratio: 2 / 3;
  margin: 0 auto;
  background: #101211;
  border-radius: 12px;
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

.modal-actions {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.guest-info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.85rem;
  background: var(--bg-cream);
  padding: 1rem;
  border-radius: var(--radius-md);

  .info-label {
    display: block;
    font-size: 0.65rem;
    color: var(--charcoal-muted);
  }
}

.guest-mini-strip {
  h4 {
    font-size: 0.75rem;
    margin-bottom: 0.5rem;
    color: var(--charcoal-muted);
  }

  .mini-thumb-row {
    display: flex;
    gap: 0.5rem;
    overflow-x: auto;
    padding-bottom: 0.35rem;
  }

  .mini-thumb {
    width: 60px;
    height: 90px;
    object-fit: cover;
    border-radius: 6px;
    cursor: pointer;
    border: 1.5px solid var(--charcoal-border);
  }
}

.fullscreen-poster {
  position: relative;
  width: 100%;
  max-width: 580px;
  padding: 2.5rem 2rem;
  background: var(--forest-green);
  color: var(--bg-cream);
  border: 3px solid var(--muted-gold);
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.85rem;

  .close-poster-btn {
    position: absolute;
    top: 1rem;
    right: 1rem;
    width: 38px;
    height: 38px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.15);
    color: var(--bg-cream);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  h1 {
    font-size: 2.2rem;
  }

  .fs-tagline {
    font-style: italic;
    font-size: 1.05rem;
  }

  .fs-qr-box {
    background: #faf7f0;
    padding: 1.15rem;
    border-radius: 18px;
    margin: 0.5rem 0;

    img {
      width: 300px;
      height: 300px;
      display: block;
    }
  }

  .fs-instructions {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.95rem;
  }
}

@media (max-width: 960px) {
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .qr-management-grid,
  .settings-switches,
  .form-row-2 {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 560px) {
  .dashboard-main {
    padding: 1rem 0.75rem 2.5rem;
  }

  .stats-grid {
    grid-template-columns: 1fr 1fr;
    gap: 0.6rem;
  }

  .stat-card {
    padding: 0.85rem;
    .stat-value {
      font-size: 1.55rem;
    }
  }

  .dashboard-tabs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.4rem;
  }

  .dash-tab {
    justify-content: center;
    padding: 0.55rem 0.65rem;
    font-size: 0.8rem;
  }

  .admin-photo-grid {
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 0.75rem;
  }

  .admin-photo-masonry {
    columns: 2 145px;
    column-gap: 0.75rem;
  }
}
</style>

