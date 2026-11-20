import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  CameraSession,
  EventSettings,
  Guest,
  GuestRegistrationInput,
  LocalOriginalPhotoRecord,
  PhotoRecord,
  UploadProgressInfo
} from '@/types'
import {
  clearActiveClientSession,
  DEFAULT_EVENT_ID,
  fetchCameraSessionById,
  fetchEventSettings,
  fetchGuestById,
  fetchGuestPhotos,
  getActiveClientSession,
  getDefaultEventSettings,
  reconcileAndGetPendingUploads,
  recoverGuestSession,
  registerGuest,
  retryPendingPhotoUpload,
  submitCapturedPhoto,
  type SubmitCapturedPhotoParams,
  updateEventSettings
} from '@/services/repository'
import {
  deleteOriginalPhoto,
  getGuestPhotos as getLocalIndexedDbGuestPhotos
} from '@/services/indexedDbStorage'
import {
  getCurrentAdminSession,
  signInAdmin,
  signInAdminWithGoogle,
  signInGuestWithGoogle,
  signOutAdmin,
  type AdminUserSession,
  type GoogleGuestProfile
} from '@/services/adminAuth'

export const useSessionStore = defineStore('xmasRollSession', () => {
  const event = ref<EventSettings>(getDefaultEventSettings(DEFAULT_EVENT_ID))
  const guest = ref<Guest | null>(null)
  const cameraSession = ref<CameraSession | null>(null)
  const guestPhotos = ref<PhotoRecord[]>([])
  const localOriginals = ref<LocalOriginalPhotoRecord[]>([])
  const pendingUploads = ref<LocalOriginalPhotoRecord[]>([])
  const uploadProgress = ref<UploadProgressInfo | null>(null)
  const adminUser = ref<AdminUserSession | null>(null)

  const isLoading = ref(false)
  const isHydrated = ref(false)

  const totalShots = computed(() => cameraSession.value?.totalShots ?? 10)
  const usedShots = computed(() => cameraSession.value?.usedShots ?? 0)
  const remainingShots = computed(() => Math.max(0, totalShots.value - usedShots.value))
  const isRollExhausted = computed(() => remainingShots.value <= 0)
  const hasActiveGuestSession = computed(() => Boolean(guest.value && cameraSession.value))
  const isAdminAuthenticated = computed(
    () => Boolean(adminUser.value && adminUser.value.isAdminVerified)
  )

  const localOriginalsMap = computed(() => {
    const map = new Map<string, LocalOriginalPhotoRecord>()
    for (const rec of localOriginals.value) {
      map.set(rec.photoId, rec)
      map.set(rec.id, rec)
    }
    return map
  })

  function hasLocalOriginal(photoId: string): boolean {
    const rec = localOriginalsMap.value.get(photoId)
    return Boolean(rec && rec.imageBlob && rec.imageBlob.size > 0)
  }

  async function refreshLocalOriginals(): Promise<void> {
    if (!guest.value) {
      localOriginals.value = []
      pendingUploads.value = []
      return
    }
    try {
      const reconciledPending = await reconcileAndGetPendingUploads(
        guest.value.id,
        event.value.id
      )
      const allLocal = await getLocalIndexedDbGuestPhotos(guest.value.id, event.value.id)
      localOriginals.value = allLocal
      pendingUploads.value = reconciledPending
    } catch {
      // If IndexedDB is blocked in private mode, keep empty lists without crashing session hydration
      localOriginals.value = []
      pendingUploads.value = []
    }
  }

  async function refreshEventSettings(eventId = DEFAULT_EVENT_ID): Promise<EventSettings> {
    const loaded = await fetchEventSettings(eventId)
    event.value = loaded
    return loaded
  }

  async function hydrateGuestSession(): Promise<boolean> {
    isLoading.value = true
    try {
      await refreshEventSettings()
      const persisted = getActiveClientSession()
      if (!persisted) {
        guest.value = null
        cameraSession.value = null
        guestPhotos.value = []
        localOriginals.value = []
        pendingUploads.value = []
        return false
      }

      const [loadedGuest, loadedSession, loadedPhotos] = await Promise.all([
        fetchGuestById(persisted.guestId),
        fetchCameraSessionById(persisted.sessionId),
        fetchGuestPhotos(persisted.guestId, persisted.eventId)
      ])

      if (!loadedGuest || !loadedSession) {
        clearActiveClientSession()
        guest.value = null
        cameraSession.value = null
        guestPhotos.value = []
        localOriginals.value = []
        pendingUploads.value = []
        return false
      }

      guest.value = loadedGuest
      cameraSession.value = loadedSession
      guestPhotos.value = loadedPhotos
      await refreshLocalOriginals()
      return true
    } finally {
      isLoading.value = false
      isHydrated.value = true
    }
  }

  async function registerNewGuest(input: GuestRegistrationInput): Promise<void> {
    isLoading.value = true
    try {
      const result = await registerGuest(input, event.value.id)
      guest.value = result.guest
      cameraSession.value = result.session
      guestPhotos.value = []
      localOriginals.value = []
      pendingUploads.value = []
    } finally {
      isLoading.value = false
    }
  }

  async function recoverExistingGuest(
    fullName: string,
    verificationInput: string
  ): Promise<void> {
    isLoading.value = true
    try {
      const result = await recoverGuestSession(fullName, verificationInput, event.value.id)
      guest.value = result.guest
      cameraSession.value = result.session
      guestPhotos.value = await fetchGuestPhotos(result.guest.id, event.value.id)
      await refreshLocalOriginals()
    } finally {
      isLoading.value = false
    }
  }

  async function uploadAndConsumeShot(
    payload: Omit<SubmitCapturedPhotoParams, 'sessionId' | 'guestId'>
  ): Promise<PhotoRecord> {
    if (!cameraSession.value || !guest.value) {
      throw new Error('No active camera session found.')
    }

    uploadProgress.value = {
      step: 'saving-local',
      label: 'Saving HD original locally...',
      percent: 15
    }

    try {
      const result = await submitCapturedPhoto({
        ...payload,
        sessionId: cameraSession.value.id,
        guestId: guest.value.id,
        onProgress: (info) => {
          uploadProgress.value = info
          payload.onProgress?.(info)
        }
      })

      cameraSession.value = result.updatedSession
      guest.value = result.updatedGuest
      guestPhotos.value = [
        ...guestPhotos.value.filter((p) => p.id !== result.photo.id),
        result.photo
      ].sort((a, b) => a.shotNumber - b.shotNumber)

      await refreshLocalOriginals()
      return result.photo
    } catch (err) {
      await refreshLocalOriginals()
      throw err
    } finally {
      setTimeout(() => {
        uploadProgress.value = null
      }, 600)
    }
  }

  async function retryFailedPhotoUpload(photoId: string): Promise<PhotoRecord> {
    if (!cameraSession.value || !guest.value) {
      throw new Error('No active camera session found.')
    }

    uploadProgress.value = {
      step: 'compressing',
      label: 'Retrying upload from local HD original...',
      percent: 30
    }

    try {
      const result = await retryPendingPhotoUpload(photoId, (info) => {
        uploadProgress.value = info
      })

      cameraSession.value = result.updatedSession
      guest.value = result.updatedGuest
      guestPhotos.value = [
        ...guestPhotos.value.filter((p) => p.id !== result.photo.id),
        result.photo
      ].sort((a, b) => a.shotNumber - b.shotNumber)

      await refreshLocalOriginals()
      return result.photo
    } finally {
      setTimeout(() => {
        uploadProgress.value = null
      }, 600)
    }
  }

  async function discardFailedPhotoUpload(photoId: string): Promise<void> {
    await deleteOriginalPhoto(photoId)
    await refreshLocalOriginals()
  }

  async function refreshGuestRoll(): Promise<void> {
    if (!guest.value || !cameraSession.value) return
    const [freshGuest, freshSession, freshPhotos] = await Promise.all([
      fetchGuestById(guest.value.id),
      fetchCameraSessionById(cameraSession.value.id),
      fetchGuestPhotos(guest.value.id, event.value.id)
    ])
    if (freshGuest) guest.value = freshGuest
    if (freshSession) cameraSession.value = freshSession
    guestPhotos.value = freshPhotos
    await refreshLocalOriginals()
  }

  async function saveEventConfiguration(
    updates: Partial<Omit<EventSettings, 'id' | 'createdAt'>>
  ): Promise<EventSettings> {
    const updated = await updateEventSettings(event.value.id, updates)
    event.value = updated
    return updated
  }

  async function hydrateAdminAuth(): Promise<AdminUserSession | null> {
    const session = await getCurrentAdminSession()
    adminUser.value = session
    return session
  }

  async function loginAdmin(email: string, password: string): Promise<AdminUserSession> {
    const session = await signInAdmin(email, password)
    adminUser.value = session
    return session
  }

  async function loginAdminWithGoogle(): Promise<AdminUserSession> {
    const session = await signInAdminWithGoogle()
    adminUser.value = session
    return session
  }

  async function authenticateGuestWithGoogle(): Promise<GoogleGuestProfile> {
    return await signInGuestWithGoogle()
  }

  async function logoutAdmin(): Promise<void> {
    await signOutAdmin()
    adminUser.value = null
  }

  return {
    event,
    guest,
    cameraSession,
    guestPhotos,
    localOriginals,
    localOriginalsMap,
    pendingUploads,
    uploadProgress,
    adminUser,
    isLoading,
    isHydrated,
    totalShots,
    usedShots,
    remainingShots,
    isRollExhausted,
    hasActiveGuestSession,
    isAdminAuthenticated,
    hasLocalOriginal,
    refreshLocalOriginals,
    refreshEventSettings,
    hydrateGuestSession,
    registerNewGuest,
    recoverExistingGuest,
    uploadAndConsumeShot,
    retryFailedPhotoUpload,
    discardFailedPhotoUpload,
    refreshGuestRoll,
    saveEventConfiguration,
    hydrateAdminAuth,
    loginAdmin,
    loginAdminWithGoogle,
    authenticateGuestWithGoogle,
    logoutAdmin
  }
})
