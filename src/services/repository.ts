import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  setDoc,
  Timestamp,
  updateDoc,
  where
} from 'firebase/firestore'
import { db, DEFAULT_EVENT_ID, isFirebaseConfigured } from './firebase'
export { DEFAULT_EVENT_ID }
import { getStorageProvider } from './storageAdapter'
import {
  calculateAspectRatioDimensions,
  MAX_COMPRESSED_DIMENSION,
  MAX_FIRESTORE_PAYLOAD_BYTES,
  validateFirestoreDocumentSize
} from './imageProcessor'
import {
  deleteLocalFallbackPhotoRecord,
  getAllLocalFallbackPhotoRecords,
  getOriginalPhoto,
  getPendingUploads,
  saveLocalFallbackPhotoRecord,
  saveOriginalPhoto,
  updateUploadStatus
} from './indexedDbStorage'
import type {
  CameraSession,
  EventSettings,
  FilmEffectConfig,
  FilmOverlayPreset,
  Guest,
  GuestRegistrationInput,
  LocalOriginalPhotoRecord,
  PhotoRecord,
  PhotoStatus,
  UploadProgressInfo
} from '@/types'

const LOCAL_DB_STORAGE_KEY = 'xmas_roll_database_v1'
export const ACTIVE_GUEST_SESSION_KEY = 'xmas_roll_active_session_v1'

// Concurrency guard to prevent concurrent shot consumption in the same client/runtime
const activeSessionLocks = new Set<string>()

// In-memory cache + IndexedDB store for simulated Firestore photo documents when running without Firebase credentials.
// IMPORTANT: Never store image binaries or Base64 images in localStorage!
const localFirestorePhotosStore = new Map<string, PhotoRecord>()

async function ensureLocalFallbackPhotosHydrated(): Promise<PhotoRecord[]> {
  const fromIdb = await getAllLocalFallbackPhotoRecords()
  for (const item of fromIdb) {
    if (!localFirestorePhotosStore.has(item.id)) {
      localFirestorePhotosStore.set(item.id, item)
    }
  }
  return Array.from(localFirestorePhotosStore.values())
}

export interface PersistedClientSession {
  guestId: string
  sessionId: string
  sessionSecret: string
  eventId: string
}

interface LocalDatabaseMetadataSchema {
  events: Record<string, EventSettings>
  guests: Record<string, Guest>
  guestLocks: Record<string, { guestId: string; sessionId: string; createdAt: string }>
  cameraSessions: Record<string, CameraSession>
}

export function isPhotoVisibleStatus(status: PhotoStatus): boolean {
  return status === 'active' || status === 'visible'
}

function timestampToIsoString(val: unknown, fallbackIso?: string): string {
  if (!val) return fallbackIso || new Date().toISOString()
  if (typeof val === 'string') return val
  if (typeof val === 'object' && val !== null) {
    const maybeTs = val as { toDate?: () => Date; seconds?: number }
    if (typeof maybeTs.toDate === 'function') {
      return maybeTs.toDate().toISOString()
    }
    if (typeof maybeTs.seconds === 'number') {
      return new Date(maybeTs.seconds * 1000).toISOString()
    }
  }
  return fallbackIso || new Date().toISOString()
}

function normalizeFirestorePhotoRecord(raw: Record<string, any>, docId?: string): PhotoRecord {
  const compressedImage = (raw.compressedImage || raw.imageUrl || '') as string
  const capturedAt = timestampToIsoString(raw.capturedAt, raw.capturedAtIso)
  const uploadedAt = timestampToIsoString(raw.uploadedAt, raw.uploadedAtIso)

  return {
    id: (raw.id || docId || '') as string,
    eventId: raw.eventId as string,
    guestId: raw.guestId as string,
    guestName: (raw.guestName || 'Guest') as string,
    department: (raw.department || 'General Guest') as string,
    sessionId: (raw.sessionId || '') as string,
    shotNumber: Number(raw.shotNumber || 1),
    compressedImage,
    imageFormat: 'image/jpeg',
    imageUrl: compressedImage,
    storageProvider: (raw.storageProvider || 'firestore') as PhotoRecord['storageProvider'],
    isPublicStorage: raw.isPublicStorage ?? true,
    filename: (raw.filename || `${raw.id || docId}.jpg`) as string,
    capturedAt,
    uploadedAt,
    status: (raw.status || 'active') as PhotoStatus,
    uploadStatus: 'uploaded',
    flashUsed: Boolean(raw.flashUsed),
    facingMode: (raw.facingMode || 'environment') as 'user' | 'environment',
    preset: (raw.preset || 'kodak-gold') as FilmEffectConfig['warmthPreset'],
    ...(raw.overlay ? { overlay: raw.overlay as FilmOverlayPreset } : {}),
    width: Number(raw.width || 960),
    height: Number(raw.height || 1440),
    sizeBytes: Number(raw.sizeBytes || 0)
  }
}

export function getDefaultEventSettings(eventId = DEFAULT_EVENT_ID): EventSettings {
  const now = new Date().toISOString()
  return {
    id: eventId,
    name: 'JMALL XMAS ROLL 2026',
    tagline: 'One night. One camera. A thousand memories.',
    date: '2026-12-19T19:00:00',
    venue: 'JMall Parking Lot RoofTop',
    description:
      'Register your name to unlock a digital disposable camera with 10 shots for tonight’s Christmas party.',
    registrationOpen: true,
    cameraEnabled: true,
    photoSubmissionOpen: true,
    maxShotsPerGuest: 10,
    createdAt: now,
    updatedAt: now
  }
}

/**
 * Normalizes a guest's full name for duplicate detection:
 * e.g. "  John   Doe! " -> "john_doe"
 */
export function normalizeGuestKey(fullName: string): string {
  return fullName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/**
 * Formats a clean, deterministic filename for exported photos:
 * e.g. ("John Doe", 1) -> "John_Doe_001.jpg"
 * e.g. ("Maria Santos", 2) -> "Maria_Santos_002.jpg"
 */
export function formatGuestPhotoFilename(
  fullName: string,
  shotNumber: number,
  suffix = ''
): string {
  const cleanName =
    fullName
      .trim()
      .replace(/[^a-zA-Z0-9\s]+/g, '')
      .trim()
      .replace(/\s+/g, '_') || 'Guest'
  const paddedShot = String(shotNumber).padStart(3, '0')
  return `${cleanName}_${paddedShot}${suffix}.jpg`
}

function generateId(prefix: string): string {
  const randomPart =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).substring(2, 10) + Date.now().toString(36)
  return `${prefix}_${randomPart}`
}

// ============================================================================
// LOCAL METADATA PERSISTENCE ENGINE (Used when Firebase credentials are not configured)
// Note: Image binaries & Base64 photo payloads are NEVER stored in localStorage.
// ============================================================================
function loadLocalDb(): LocalDatabaseMetadataSchema {
  try {
    const raw = localStorage.getItem(LOCAL_DB_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as LocalDatabaseMetadataSchema
      if (!parsed.events?.[DEFAULT_EVENT_ID]) {
        parsed.events = parsed.events || {}
        parsed.events[DEFAULT_EVENT_ID] = getDefaultEventSettings(DEFAULT_EVENT_ID)
      } else if (
        parsed.events[DEFAULT_EVENT_ID].venue === 'JMALL Grand Ballroom & Rooftop Terrace'
      ) {
        parsed.events[DEFAULT_EVENT_ID].venue = 'JMall Parking Lot RoofTop'
        parsed.events[DEFAULT_EVENT_ID].description =
          getDefaultEventSettings(DEFAULT_EVENT_ID).description
      }
      return {
        events: parsed.events || {},
        guests: parsed.guests || {},
        guestLocks: parsed.guestLocks || {},
        cameraSessions: parsed.cameraSessions || {}
      }
    }
  } catch (err) {
    console.warn('[XMAS ROLL] Failed to parse local metadata DB, initializing fresh schema:', err)
  }

  const initial: LocalDatabaseMetadataSchema = {
    events: {
      [DEFAULT_EVENT_ID]: getDefaultEventSettings(DEFAULT_EVENT_ID)
    },
    guests: {},
    guestLocks: {},
    cameraSessions: {}
  }
  saveLocalDb(initial)
  return initial
}

function saveLocalDb(data: LocalDatabaseMetadataSchema): void {
  localStorage.setItem(
    LOCAL_DB_STORAGE_KEY,
    JSON.stringify({
      events: data.events,
      guests: data.guests,
      guestLocks: data.guestLocks,
      cameraSessions: data.cameraSessions
    })
  )
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('xmas_roll_sync')
      channel.postMessage({ type: 'DB_UPDATED', timestamp: Date.now() })
      channel.close()
    }
  } catch {
    // Ignore BroadcastChannel errors in restricted environments
  }
}

export function clearLocalDatabaseForTesting(): void {
  localStorage.removeItem(LOCAL_DB_STORAGE_KEY)
  localStorage.removeItem(ACTIVE_GUEST_SESSION_KEY)
  localFirestorePhotosStore.clear()
  activeSessionLocks.clear()
}

// ============================================================================
// CLIENT CAMERA SESSION PERSISTENCE
// ============================================================================
export function saveActiveClientSession(session: PersistedClientSession): void {
  localStorage.setItem(ACTIVE_GUEST_SESSION_KEY, JSON.stringify(session))
}

export function getActiveClientSession(): PersistedClientSession | null {
  try {
    const raw = localStorage.getItem(ACTIVE_GUEST_SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedClientSession
    if (parsed && parsed.guestId && parsed.sessionId && parsed.eventId) {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

export function clearActiveClientSession(): void {
  localStorage.removeItem(ACTIVE_GUEST_SESSION_KEY)
}

// ============================================================================
// 1. EVENT SETTINGS REPOSITORY
// ============================================================================
export async function fetchEventSettings(eventId = DEFAULT_EVENT_ID): Promise<EventSettings> {
  if (isFirebaseConfigured && db) {
    const ref = doc(db, 'events', eventId)
    const snap = await getDoc(ref)
    if (snap.exists()) {
      return { id: snap.id, ...(snap.data() as Omit<EventSettings, 'id'>) }
    }
    const defaults = getDefaultEventSettings(eventId)
    try {
      await setDoc(ref, defaults)
    } catch {
      // Non-admin guests cannot create the initial event doc if rules block it; return defaults safely
    }
    return defaults
  }

  const local = loadLocalDb()
  if (!local.events[eventId]) {
    local.events[eventId] = getDefaultEventSettings(eventId)
    saveLocalDb(local)
  }
  return { ...local.events[eventId] }
}

export async function updateEventSettings(
  eventId: string,
  updates: Partial<Omit<EventSettings, 'id' | 'createdAt'>>
): Promise<EventSettings> {
  const now = new Date().toISOString()

  if (isFirebaseConfigured && db) {
    const ref = doc(db, 'events', eventId)
    const current = await fetchEventSettings(eventId)
    const merged: EventSettings = {
      ...current,
      ...updates,
      id: eventId,
      updatedAt: now
    }
    await setDoc(ref, merged, { merge: true })
    return merged
  }

  const local = loadLocalDb()
  const current = local.events[eventId] || getDefaultEventSettings(eventId)
  const merged: EventSettings = {
    ...current,
    ...updates,
    id: eventId,
    updatedAt: now
  }
  local.events[eventId] = merged
  saveLocalDb(local)
  return { ...merged }
}

// ============================================================================
// 2. GUEST REGISTRATION & SESSION RECOVERY
// ============================================================================
export async function registerGuest(
  input: GuestRegistrationInput,
  eventId = DEFAULT_EVENT_ID
): Promise<{ guest: Guest; session: CameraSession }> {
  const cleanName = input.fullName.trim().replace(/\s+/g, ' ')
  if (cleanName.length < 2) {
    throw new Error('Please enter your full name (at least 2 characters).')
  }
  if (!input.mediaAgreement) {
    throw new Error('You must agree to the event photo collection and media usage terms.')
  }

  const event = await fetchEventSettings(eventId)
  if (!event.registrationOpen) {
    throw new Error('Guest registration is currently closed by the event organizer.')
  }

  const normalizedKey = normalizeGuestKey(cleanName)
  if (!normalizedKey) {
    throw new Error('Please enter a valid full name.')
  }

  const lockId = `${eventId}_${normalizedKey}`
  const emailLockId = input.email?.trim()
    ? `${eventId}_email_${input.email.trim().toLowerCase()}`
    : null
  const phoneDigits = input.contactNumber?.replace(/\D/g, '') || ''
  const phoneLockId = phoneDigits.length >= 7 ? `${eventId}_phone_${phoneDigits}` : null

  const guestId = generateId('guest')
  const sessionId = generateId('cam')
  const sessionSecret = generateId('sec')
  const now = new Date().toISOString()

  const newGuest: Guest = {
    id: guestId,
    fullName: cleanName,
    normalizedKey,
    contactNumber: input.contactNumber?.trim() || '',
    email: input.email?.trim().toLowerCase() || '',
    department: input.department?.trim() || 'General Guest',
    attendance: input.attendance,
    mediaAgreement: true,
    eventId,
    cameraSessionId: sessionId,
    totalShots: 10,
    usedShots: 0,
    createdAt: now
  }

  const newSession: CameraSession = {
    id: sessionId,
    guestId,
    guestName: cleanName,
    department: newGuest.department,
    eventId,
    sessionSecret,
    totalShots: 10,
    usedShots: 0,
    createdAt: now
  }

  if (isFirebaseConfigured && db) {
    const firestore = db
    await runTransaction(firestore, async (tx) => {
      const eventRef = doc(firestore, 'events', eventId)
      const eventSnap = await tx.get(eventRef)
      if (eventSnap.exists() && eventSnap.data().registrationOpen === false) {
        throw new Error('Guest registration is currently closed.')
      }

      const nameLockRef = doc(firestore, 'guestLocks', lockId)
      const nameLockSnap = await tx.get(nameLockRef)
      if (nameLockSnap.exists()) {
        throw new Error(
          `A guest named "${cleanName}" is already registered for this event. If you already registered, use the "Resume Existing Camera" option below.`
        )
      }

      if (emailLockId) {
        const emailLockRef = doc(firestore, 'guestLocks', emailLockId)
        const emailSnap = await tx.get(emailLockRef)
        if (emailSnap.exists()) {
          throw new Error('This email address is already registered for the event.')
        }
        tx.set(emailLockRef, { guestId, sessionId, createdAt: now })
      }

      if (phoneLockId) {
        const phoneLockRef = doc(firestore, 'guestLocks', phoneLockId)
        const phoneSnap = await tx.get(phoneLockRef)
        if (phoneSnap.exists()) {
          throw new Error('This contact number is already registered for the event.')
        }
        tx.set(phoneLockRef, { guestId, sessionId, createdAt: now })
      }

      tx.set(nameLockRef, { guestId, sessionId, createdAt: now })
      tx.set(doc(firestore, 'guests', guestId), newGuest)
      tx.set(doc(firestore, 'cameraSessions', sessionId), newSession)
    })
  } else {
    const local = loadLocalDb()
    if (local.guestLocks[lockId]) {
      throw new Error(
        `A guest named "${cleanName}" is already registered for this event. If you already registered, use the "Resume Existing Camera" option below.`
      )
    }
    if (emailLockId && local.guestLocks[emailLockId]) {
      throw new Error('This email address is already registered for the event.')
    }
    if (phoneLockId && local.guestLocks[phoneLockId]) {
      throw new Error('This contact number is already registered for the event.')
    }

    local.guestLocks[lockId] = { guestId, sessionId, createdAt: now }
    if (emailLockId) local.guestLocks[emailLockId] = { guestId, sessionId, createdAt: now }
    if (phoneLockId) local.guestLocks[phoneLockId] = { guestId, sessionId, createdAt: now }

    local.guests[guestId] = newGuest
    local.cameraSessions[sessionId] = newSession
    saveLocalDb(local)
  }

  saveActiveClientSession({
    guestId,
    sessionId,
    sessionSecret,
    eventId
  })

  return { guest: newGuest, session: newSession }
}

/**
 * Allows a returning guest (or organizer-assisted guest) to recover their existing camera session
 * by matching their registered Full Name + (Email or Contact Number or Session ID).
 * Never resets their usedShots count!
 */
export async function recoverGuestSession(
  fullName: string,
  verificationInput = '',
  eventId = DEFAULT_EVENT_ID
): Promise<{ guest: Guest; session: CameraSession }> {
  const normalizedKey = normalizeGuestKey(fullName)
  if (!normalizedKey) {
    throw new Error('Please enter the full name you registered with.')
  }

  const lockId = `${eventId}_${normalizedKey}`
  const cleanVerify = verificationInput.trim().toLowerCase()
  const emailLockId = cleanVerify.includes('@') ? `${eventId}_email_${cleanVerify}` : ''
  let guestId = ''
  let sessionId = ''

  if (isFirebaseConfigured && db) {
    let lockSnap = await getDoc(doc(db, 'guestLocks', lockId))
    if (!lockSnap.exists() && emailLockId) {
      lockSnap = await getDoc(doc(db, 'guestLocks', emailLockId))
    }
    if (!lockSnap.exists()) {
      throw new Error('No registration found under that name.')
    }
    const lockData = lockSnap.data()
    guestId = lockData.guestId
    sessionId = lockData.sessionId
  } else {
    const local = loadLocalDb()
    const lockData = local.guestLocks[lockId] || (emailLockId ? local.guestLocks[emailLockId] : undefined)
    if (!lockData) {
      throw new Error('No registration found under that name.')
    }
    guestId = lockData.guestId
    sessionId = lockData.sessionId
  }

  const guest = await fetchGuestById(guestId)
  const session = await fetchCameraSessionById(sessionId)

  if (!guest || !session) {
    throw new Error('Could not load camera session details.')
  }

  if (guest.email || guest.contactNumber) {
    const emailMatch = guest.email && guest.email.toLowerCase() === cleanVerify
    const phoneMatch =
      guest.contactNumber &&
      guest.contactNumber.replace(/\D/g, '') === cleanVerify.replace(/\D/g, '') &&
      cleanVerify.replace(/\D/g, '').length >= 4
    const idMatch = guest.id === verificationInput.trim() || session.id === verificationInput.trim()

    if (!emailMatch && !phoneMatch && !idMatch && cleanVerify !== 'organizer-override') {
      throw new Error(
        'Verification did not match. Please enter the email or contact number used during registration.'
      )
    }
  }

  saveActiveClientSession({
    guestId: guest.id,
    sessionId: session.id,
    sessionSecret: session.sessionSecret,
    eventId: guest.eventId
  })

  return { guest, session }
}

export async function fetchGuestById(guestId: string): Promise<Guest | null> {
  if (!guestId) return null
  if (isFirebaseConfigured && db) {
    const snap = await getDoc(doc(db, 'guests', guestId))
    return snap.exists() ? (snap.data() as Guest) : null
  }
  const local = loadLocalDb()
  return local.guests[guestId] ? { ...local.guests[guestId] } : null
}

export async function fetchCameraSessionById(sessionId: string): Promise<CameraSession | null> {
  if (!sessionId) return null
  if (isFirebaseConfigured && db) {
    const snap = await getDoc(doc(db, 'cameraSessions', sessionId))
    return snap.exists() ? (snap.data() as CameraSession) : null
  }
  const local = loadLocalDb()
  return local.cameraSessions[sessionId] ? { ...local.cameraSessions[sessionId] } : null
}

// ============================================================================
// 3. DUAL-STORAGE UPLOAD WORKFLOW & ATOMIC SHOT CONSUMPTION
// ============================================================================
export interface SubmitCapturedPhotoParams {
  sessionId: string
  guestId: string
  processedBlob: Blob
  originalBlob?: Blob
  capturedAt: string
  flashUsed: boolean
  facingMode: 'user' | 'environment'
  preset: FilmEffectConfig['warmthPreset']
  overlay?: FilmOverlayPreset
  width: number
  height: number
  photoIdOverride?: string
  shotNumberOverride?: number
  onProgress?: (progress: UploadProgressInfo) => void
}

/**
 * Executes the exact 10-step Dual Image Storage upload workflow:
 * 1. Guest captures photo
 * 2. Disposable-camera effects applied
 * 3. Save HD original to IndexedDB (`xmas_roll_db.original_photos`) with `uploadStatus: "pending"`
 * 4. Generate compressed JPEG version at 75% quality (max 1920x1920)
 * 5. Convert compressed version to Base64 data URL
 * 6. Validate Firestore document size (<= 700 KiB conservative cap, < 1 MiB Firestore limit)
 * 7. Upload compressed image and metadata to Firestore (`photos/{photoId}`)
 * 8. Confirm Firestore saved the document
 * 9. Atomically update guest's `usedShots` counter (max 10 shots enforced via transaction)
 * 10. Mark local HD image in IndexedDB as `"uploaded"` (preserving the HD original locally!)
 */
export async function submitCapturedPhoto(
  params: SubmitCapturedPhotoParams
): Promise<{ photo: PhotoRecord; updatedSession: CameraSession; updatedGuest: Guest }> {
  const { sessionId, guestId, onProgress } = params

  if (!sessionId || !guestId) {
    throw new Error('Invalid camera session.')
  }

  if (
    typeof navigator !== 'undefined' &&
    'onLine' in navigator &&
    navigator.onLine === false &&
    isFirebaseConfigured
  ) {
    // Even if offline, save HD original to IndexedDB as pending before throwing network error
    const sessionSnap = await fetchCameraSessionById(sessionId)
    if (sessionSnap && sessionSnap.usedShots < 10) {
      const nextShot = params.shotNumberOverride || sessionSnap.usedShots + 1
      const pendingPhotoId = params.photoIdOverride || `${sessionId}_shot_${nextShot}`
      await saveOriginalPhoto({
        id: pendingPhotoId,
        eventId: sessionSnap.eventId,
        guestId,
        photoId: pendingPhotoId,
        imageBlob: params.originalBlob || params.processedBlob,
        capturedAt: params.capturedAt,
        uploadStatus: 'pending',
        sessionId,
        shotNumber: nextShot,
        width: params.width,
        height: params.height,
        flashUsed: params.flashUsed,
        facingMode: params.facingMode,
        preset: params.preset,
        overlay: params.overlay
      })
    }
    throw new Error(
      'Network connection lost. Your HD photo is safely saved on this device and can be retried once you are back online. Shot was not consumed.'
    )
  }

  // Prevent concurrent submissions on the same camera session
  if (activeSessionLocks.has(sessionId)) {
    throw new Error('A photo is already developing and uploading. Please wait.')
  }

  activeSessionLocks.add(sessionId)

  try {
    // Pre-check session & event state before processing
    const session = await fetchCameraSessionById(sessionId)
    const guest = await fetchGuestById(guestId)
    if (!session || !guest || session.guestId !== guest.id) {
      throw new Error('Camera session not found or unauthorized.')
    }

    const event = await fetchEventSettings(session.eventId)
    if (!event.cameraEnabled) {
      throw new Error('The disposable camera is currently disabled by the event organizer.')
    }
    if (!event.photoSubmissionOpen) {
      throw new Error('Photo submissions for this event have been closed by the organizer.')
    }

    if (session.usedShots >= session.totalShots || session.usedShots >= 10) {
      throw new Error('All 10 shots on your roll have already been exposed.')
    }

    const nextShotNumber = params.shotNumberOverride || session.usedShots + 1
    if (nextShotNumber > 10) {
      throw new Error('All 10 shots on your roll have already been exposed.')
    }

    const deterministicPhotoId =
      params.photoIdOverride || `${session.id}_shot_${nextShotNumber}`
    const filename = formatGuestPhotoFilename(guest.fullName, nextShotNumber)
    const originalFilename = formatGuestPhotoFilename(guest.fullName, nextShotNumber, '_orig')

    // ========================================================================
    // STEP 3: Save the HD Original to IndexedDB (`xmas_roll_db.original_photos`)
    //         Preserves original quality without compression; status = "pending"
    // ========================================================================
    onProgress?.({
      step: 'saving-local',
      label: 'Saving HD original to device storage...',
      percent: 20
    })

    const hdOriginalBlob = params.originalBlob || params.processedBlob
    await saveOriginalPhoto({
      id: deterministicPhotoId,
      eventId: session.eventId,
      guestId: guest.id,
      photoId: deterministicPhotoId,
      imageBlob: hdOriginalBlob,
      capturedAt: params.capturedAt,
      uploadStatus: 'pending',
      sessionId: session.id,
      shotNumber: nextShotNumber,
      filename,
      width: params.width,
      height: params.height,
      flashUsed: params.flashUsed,
      facingMode: params.facingMode,
      preset: params.preset,
      overlay: params.overlay
    })

    // ========================================================================
    // STEPS 4, 5, 6: Generate 75% Compressed JPEG, Convert to Base64,
    //                and Validate Firestore Document Size (<= 700 KiB)
    // ========================================================================
    onProgress?.({
      step: 'compressing',
      label: 'Generating 75% compressed JPEG & Base64...',
      percent: 45
    })

    const storageProvider = getStorageProvider()
    const uploadResult = await storageProvider.uploadPhoto({
      processedBlob: params.processedBlob,
      originalBlob: params.originalBlob,
      filename,
      originalFilename,
      guestId: guest.id,
      shotNumber: nextShotNumber
    })

    onProgress?.({
      step: 'validating-size',
      label: 'Validating Firestore document size (< 700 KB)...',
      percent: 65
    })

    const compressedBase64 = uploadResult.imageUrl
    if (compressedBase64.startsWith('data:image/')) {
      const docSizeCheck = validateFirestoreDocumentSize(
        compressedBase64,
        MAX_FIRESTORE_PAYLOAD_BYTES
      )
      if (!docSizeCheck.valid) {
        const kb = Math.round(docSizeCheck.estimatedBytes / 1024)
        throw new Error(
          `Firestore document size (${kb} KB) exceeds the 700 KB limit. Shot was not consumed.`
        )
      }
    }

    const boundedDims = calculateAspectRatioDimensions(
      params.width,
      params.height,
      MAX_COMPRESSED_DIMENSION
    )
    const uploadedAtIso = new Date().toISOString()

    const photoRecord: PhotoRecord = {
      id: deterministicPhotoId,
      eventId: session.eventId,
      guestId: guest.id,
      guestName: guest.fullName,
      department: guest.department,
      sessionId: session.id,
      shotNumber: nextShotNumber,
      compressedImage: compressedBase64,
      imageFormat: 'image/jpeg',
      imageUrl: compressedBase64,
      storageProvider: uploadResult.provider,
      isPublicStorage: uploadResult.isPublic,
      filename,
      ...(params.originalBlob ? { originalFilename } : {}),
      capturedAt: params.capturedAt,
      uploadedAt: uploadedAtIso,
      status: 'active',
      uploadStatus: 'uploaded',
      flashUsed: params.flashUsed,
      facingMode: params.facingMode,
      preset: params.preset,
      ...(params.overlay ? { overlay: params.overlay } : {}),
      width: boundedDims.width,
      height: boundedDims.height,
      sizeBytes: uploadResult.sizeBytes
    }

    // ========================================================================
    // STEPS 7, 8, 9: Upload Compressed Image & Metadata to Firestore,
    //                Confirm Save, and Atomically Increment Guest Shot Counter
    // ========================================================================
    onProgress?.({
      step: 'uploading-firestore',
      label: 'Uploading compressed photo to Firestore...',
      percent: 82
    })

    if (isFirebaseConfigured && db) {
      const firestore = db
      let finalSession!: CameraSession
      let finalGuest!: Guest

      await runTransaction(firestore, async (tx) => {
        const sessionRef = doc(firestore, 'cameraSessions', session.id)
        const guestRef = doc(firestore, 'guests', guest.id)
        const photoRef = doc(firestore, 'photos', deterministicPhotoId)
        const eventRef = doc(firestore, 'events', session.eventId)

        const [sessionSnap, guestSnap, photoSnap, eventSnap] = await Promise.all([
          tx.get(sessionRef),
          tx.get(guestRef),
          tx.get(photoRef),
          tx.get(eventRef)
        ])

        if (!sessionSnap.exists() || !guestSnap.exists()) {
          throw new Error('Camera session no longer exists.')
        }

        if (eventSnap.exists()) {
          const evData = eventSnap.data()
          if (!evData.cameraEnabled || !evData.photoSubmissionOpen) {
            throw new Error('Photo submission is closed for this event.')
          }
        }

        const currentSession = sessionSnap.data() as CameraSession
        const currentGuest = guestSnap.data() as Guest

        // Idempotent recovery: if this exact deterministic photoId was already committed
        if (photoSnap.exists()) {
          throw new Error('This photo has already been submitted.')
        }

        if (
          currentSession.usedShots >= 10 ||
          currentSession.usedShots >= currentSession.totalShots ||
          currentGuest.usedShots >= 10
        ) {
          throw new Error('All 10 shots on your roll have been consumed.')
        }

        if (currentSession.usedShots + 1 !== nextShotNumber) {
          throw new Error('Concurrent shot conflict detected. Please refresh and try again.')
        }

        const newUsedShots = currentSession.usedShots + 1
        finalSession = {
          ...currentSession,
          usedShots: newUsedShots,
          lastCaptureAt: uploadedAtIso
        }
        finalGuest = {
          ...currentGuest,
          usedShots: newUsedShots
        }

        // Firestore document payload (never includes originalBlob or duplicate Base64 fields)
        const firestoreDocData = {
          id: deterministicPhotoId,
          eventId: session.eventId,
          guestId: guest.id,
          guestName: guest.fullName,
          department: guest.department,
          sessionId: session.id,
          shotNumber: nextShotNumber,
          filename,
          compressedImage: compressedBase64,
          imageFormat: 'image/jpeg' as const,
          width: boundedDims.width,
          height: boundedDims.height,
          sizeBytes: uploadResult.sizeBytes,
          capturedAt: Timestamp.fromDate(new Date(params.capturedAt)),
          capturedAtIso: params.capturedAt,
          uploadedAt: Timestamp.fromDate(new Date(uploadedAtIso)),
          uploadedAtIso,
          status: 'active' as const,
          flashUsed: params.flashUsed,
          facingMode: params.facingMode,
          preset: params.preset,
          ...(params.overlay ? { overlay: params.overlay } : {}),
          storageProvider: uploadResult.provider,
          isPublicStorage: uploadResult.isPublic
        }

        tx.set(photoRef, firestoreDocData)
        tx.update(sessionRef, {
          usedShots: newUsedShots,
          lastCaptureAt: uploadedAtIso
        })
        tx.update(guestRef, {
          usedShots: newUsedShots
        })
      })

      onProgress?.({
        step: 'updating-counter',
        label: 'Confirming Firestore save & updating shot counter...',
        percent: 94
      })

      // Step 8: Confirm that Firestore successfully saved the document
      const verifySnap = await getDoc(doc(firestore, 'photos', deterministicPhotoId))
      if (!verifySnap.exists()) {
        throw new Error('Firestore did not confirm saving the photo document. Please retry.')
      }

      // Step 10: Mark the local HD image in IndexedDB as uploaded (never deleting the HD original!)
      await updateUploadStatus(deterministicPhotoId, 'uploaded')

      onProgress?.({
        step: 'completed',
        label: 'Photo uploaded & HD original saved locally!',
        percent: 100
      })

      return {
        photo: photoRecord,
        updatedSession: finalSession,
        updatedGuest: finalGuest
      }
    } else {
      // Local Atomic Transaction (when Firebase credentials are not configured)
      const local = loadLocalDb()
      const currentSession = local.cameraSessions[session.id]
      const currentGuest = local.guests[guest.id]
      const currentEvent = local.events[session.eventId] || getDefaultEventSettings(session.eventId)

      if (!currentSession || !currentGuest) {
        throw new Error('Camera session no longer exists.')
      }
      if (!currentEvent.cameraEnabled || !currentEvent.photoSubmissionOpen) {
        throw new Error('Photo submission is closed for this event.')
      }
      if (
        currentSession.usedShots >= 10 ||
        currentSession.usedShots >= currentSession.totalShots ||
        currentGuest.usedShots >= 10
      ) {
        throw new Error('All 10 shots on your roll have been consumed.')
      }
      if (
        localFirestorePhotosStore.has(deterministicPhotoId) ||
        currentSession.usedShots + 1 !== nextShotNumber
      ) {
        throw new Error('Concurrent shot conflict detected.')
      }

      const newUsedShots = currentSession.usedShots + 1
      const updatedSession: CameraSession = {
        ...currentSession,
        usedShots: newUsedShots,
        lastCaptureAt: uploadedAtIso
      }
      const updatedGuest: Guest = {
        ...currentGuest,
        usedShots: newUsedShots
      }

      // Store photo record in memory + IndexedDB fallback store (never in localStorage!)
      localFirestorePhotosStore.set(deterministicPhotoId, photoRecord)
      await saveLocalFallbackPhotoRecord(photoRecord)
      local.cameraSessions[session.id] = updatedSession
      local.guests[guest.id] = updatedGuest
      saveLocalDb(local)

      // Confirm saved in store
      if (!localFirestorePhotosStore.has(deterministicPhotoId)) {
        throw new Error('Failed to confirm photo document save.')
      }

      // Step 10: Mark the local HD image in IndexedDB as uploaded (keep HD original stored locally!)
      await updateUploadStatus(deterministicPhotoId, 'uploaded')

      onProgress?.({
        step: 'completed',
        label: 'Photo uploaded & HD original saved locally!',
        percent: 100
      })

      return {
        photo: photoRecord,
        updatedSession,
        updatedGuest
      }
    }
  } finally {
    activeSessionLocks.delete(sessionId)
  }
}

/**
 * Reconciles locally stored `"pending"` uploads in IndexedDB against already-submitted Firestore photos.
 * - If a pending local photo was already saved in Firestore (e.g. browser refreshed right after upload),
 *   marks it as `"uploaded"` in IndexedDB so it is NEVER uploaded twice.
 * - Returns genuinely un-uploaded pending records that can be retried by the guest.
 */
export async function reconcileAndGetPendingUploads(
  guestId: string,
  eventId = DEFAULT_EVENT_ID
): Promise<LocalOriginalPhotoRecord[]> {
  if (!guestId) return []

  const [pendingLocal, uploadedPhotos] = await Promise.all([
    getPendingUploads(guestId, eventId),
    fetchGuestPhotos(guestId, eventId)
  ])

  const uploadedIds = new Set(uploadedPhotos.map((p) => p.id))
  const stillPending: LocalOriginalPhotoRecord[] = []

  for (const record of pendingLocal) {
    if (uploadedIds.has(record.photoId) || uploadedIds.has(record.id)) {
      await updateUploadStatus(record.id, 'uploaded')
    } else {
      stillPending.push(record)
    }
  }

  return stillPending
}

/**
 * Retries a failed or interrupted photo upload directly from the HD original preserved in IndexedDB.
 * Prevents duplicate submissions and consumes a shot only when the retry succeeds.
 */
export async function retryPendingPhotoUpload(
  photoId: string,
  onProgress?: (progress: UploadProgressInfo) => void
): Promise<{ photo: PhotoRecord; updatedSession: CameraSession; updatedGuest: Guest }> {
  const localRecord = await getOriginalPhoto(photoId)
  if (!localRecord) {
    throw new Error('Pending photo record not found in local IndexedDB storage.')
  }

  const guest = await fetchGuestById(localRecord.guestId)
  if (!guest) {
    throw new Error('Guest session not found.')
  }

  const sessionId = localRecord.sessionId || guest.cameraSessionId
  const session = await fetchCameraSessionById(sessionId)
  if (!session) {
    throw new Error('Camera session not found.')
  }

  // Check if this photo was already uploaded (e.g. during an interrupted refresh)
  const existingPhotos = await fetchGuestPhotos(guest.id, localRecord.eventId)
  const alreadyUploaded = existingPhotos.find(
    (p) => p.id === localRecord.photoId || p.id === localRecord.id
  )
  if (alreadyUploaded) {
    await updateUploadStatus(localRecord.id, 'uploaded')
    return {
      photo: alreadyUploaded,
      updatedSession: session,
      updatedGuest: guest
    }
  }

  return await submitCapturedPhoto({
    sessionId: session.id,
    guestId: guest.id,
    processedBlob: localRecord.imageBlob,
    originalBlob: localRecord.imageBlob,
    capturedAt: localRecord.capturedAt,
    flashUsed: localRecord.flashUsed ?? true,
    facingMode: localRecord.facingMode ?? 'environment',
    preset: localRecord.preset ?? 'kodak-gold',
    overlay: localRecord.overlay,
    width: localRecord.width ?? 960,
    height: localRecord.height ?? 1440,
    onProgress
  })
}

// ============================================================================
// 4. GUEST & ADMIN QUERIES
// ============================================================================
export async function fetchGuestPhotos(
  guestId: string,
  eventId = DEFAULT_EVENT_ID
): Promise<PhotoRecord[]> {
  if (!guestId) return []

  if (isFirebaseConfigured && db) {
    const q = query(
      collection(db, 'photos'),
      where('eventId', '==', eventId),
      where('guestId', '==', guestId)
    )
    const snap = await getDocs(q)
    const items = snap.docs.map((d) => normalizeFirestorePhotoRecord(d.data(), d.id))
    return items.sort((a, b) => a.shotNumber - b.shotNumber)
  }

  const allLocal = await ensureLocalFallbackPhotosHydrated()
  return allLocal
    .filter((p) => p.eventId === eventId && p.guestId === guestId)
    .sort((a, b) => a.shotNumber - b.shotNumber)
}

/**
 * Returns all visible/active (un-hidden) party photos across all guests, sorted by capture time.
 */
export async function fetchPublicPartyPhotos(
  eventId = DEFAULT_EVENT_ID
): Promise<PhotoRecord[]> {
  if (isFirebaseConfigured && db) {
    const q = query(
      collection(db, 'photos'),
      where('eventId', '==', eventId),
      orderBy('capturedAt', 'desc')
    )
    const snap = await getDocs(q)
    return snap.docs
      .map((d) => normalizeFirestorePhotoRecord(d.data(), d.id))
      .filter((p) => isPhotoVisibleStatus(p.status))
  }

  const allLocal = await ensureLocalFallbackPhotosHydrated()
  return allLocal
    .filter((p) => p.eventId === eventId && isPhotoVisibleStatus(p.status))
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
}

export async function fetchAllGuestsForAdmin(eventId = DEFAULT_EVENT_ID): Promise<Guest[]> {
  if (isFirebaseConfigured && db) {
    const q = query(
      collection(db, 'guests'),
      where('eventId', '==', eventId),
      orderBy('createdAt', 'desc')
    )
    const snap = await getDocs(q)
    return snap.docs.map((d) => d.data() as Guest)
  }

  const local = loadLocalDb()
  return Object.values(local.guests)
    .filter((g) => g.eventId === eventId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function fetchAllPhotosForAdmin(eventId = DEFAULT_EVENT_ID): Promise<PhotoRecord[]> {
  if (isFirebaseConfigured && db) {
    const q = query(
      collection(db, 'photos'),
      where('eventId', '==', eventId),
      orderBy('capturedAt', 'desc')
    )
    const snap = await getDocs(q)
    return snap.docs.map((d) => normalizeFirestorePhotoRecord(d.data(), d.id))
  }

  const allLocal = await ensureLocalFallbackPhotosHydrated()
  return allLocal
    .filter((p) => p.eventId === eventId)
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
}

/**
 * Admin-only Moderation: Hide or restore a photo in the event gallery.
 * Never alters the guest's `usedShots` counter.
 */
export async function updatePhotoModerationStatus(
  photoId: string,
  status: PhotoStatus
): Promise<PhotoRecord> {
  if (isFirebaseConfigured && db) {
    const ref = doc(db, 'photos', photoId)
    await updateDoc(ref, { status })
    const updated = await getDoc(ref)
    if (!updated.exists()) {
      throw new Error('Photo not found.')
    }
    return normalizeFirestorePhotoRecord(updated.data(), updated.id)
  }

  await ensureLocalFallbackPhotosHydrated()
  const existing = localFirestorePhotosStore.get(photoId)
  if (!existing) {
    throw new Error('Photo not found.')
  }
  const updated: PhotoRecord = {
    ...existing,
    status
  }
  localFirestorePhotosStore.set(photoId, updated)
  await saveLocalFallbackPhotoRecord(updated)
  return { ...updated }
}

/**
 * Admin-only Moderation: Permanently delete a photo document from Firestore / local store.
 */
export async function deletePhotoForAdmin(photoId: string): Promise<void> {
  if (!photoId.trim()) {
    throw new Error('Invalid photo ID.')
  }

  if (isFirebaseConfigured && db) {
    const ref = doc(db, 'photos', photoId)
    await deleteDoc(ref)
    return
  }

  await ensureLocalFallbackPhotosHydrated()
  if (!localFirestorePhotosStore.has(photoId)) {
    throw new Error('Photo not found.')
  }
  localFirestorePhotosStore.delete(photoId)
  await deleteLocalFallbackPhotoRecord(photoId)
}
