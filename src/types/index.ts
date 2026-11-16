export type AttendanceStatus = 'attending' | 'not_attending'

export type PhotoStatus = 'active' | 'visible' | 'hidden'

export type LocalUploadStatus = 'pending' | 'uploaded'

export type StorageProviderType = 'firestore' | 'cloudinary' | 'imgbb' | 'local'

export type FilmFilterPreset =
  | 'kodak-gold'
  | 'fuji-warm'
  | 'holiday-velvet'
  | 'retro-bw'
  | 'polaroid-fade'
  | 'cyber-xmas'

export type FilmOverlayPreset =
  | '35mm-film'
  | 'polaroid'
  | 'light-leak'
  | 'xmas-stamp'
  | 'none'

export interface EventSettings {
  id: string
  name: string
  tagline: string
  date: string
  venue: string
  description: string
  registrationOpen: boolean
  cameraEnabled: boolean
  photoSubmissionOpen: boolean
  maxShotsPerGuest: number
  createdAt: string
  updatedAt: string
}

export interface GuestRegistrationInput {
  fullName: string
  contactNumber?: string
  email?: string
  department?: string
  attendance: AttendanceStatus
  mediaAgreement: boolean
}

export interface Guest {
  id: string
  fullName: string
  normalizedKey: string
  contactNumber: string
  email: string
  department: string
  attendance: AttendanceStatus
  mediaAgreement: boolean
  eventId: string
  cameraSessionId: string
  totalShots: number
  usedShots: number
  createdAt: string
}

export interface CameraSession {
  id: string
  guestId: string
  guestName: string
  department: string
  eventId: string
  sessionSecret: string
  totalShots: number
  usedShots: number
  createdAt: string
  lastCaptureAt?: string
}

export interface FilmEffectConfig {
  grainIntensity: number       // 0.0 to 1.0 (default ~0.24)
  warmthPreset: FilmFilterPreset
  overlayPreset?: FilmOverlayPreset
  flashActive: boolean
  vignetteIntensity: number    // 0.0 to 1.0 (default ~0.38)
  dateStamp: boolean
  filmFrameOverlay: boolean
}

/**
 * VERSION A — HD ORIGINAL (Stored locally in IndexedDB `xmas_roll_db.original_photos`)
 * Preserves the original captured image without compression or quality reduction.
 */
export interface LocalOriginalPhotoRecord {
  id: string
  eventId: string
  guestId: string
  photoId: string
  imageBlob: Blob
  capturedAt: string
  uploadStatus: LocalUploadStatus
  // Metadata for local gallery display, ZIP export, and failed upload retry recovery
  sessionId?: string
  shotNumber?: number
  filename?: string
  width?: number
  height?: number
  flashUsed?: boolean
  facingMode?: 'user' | 'environment'
  preset?: FilmFilterPreset
  overlay?: FilmOverlayPreset
}

/**
 * VERSION B — COMPRESSED IMAGE (Stored in Firestore `photos/{photoId}`)
 * Processed via Canvas API at 75% JPEG quality (max 1920x1920) and encoded as Base64 data URL.
 */
export interface PhotoRecord {
  id: string
  eventId: string
  guestId: string
  guestName: string
  department: string
  sessionId: string
  shotNumber: number           // 1 to 10
  compressedImage: string      // Base64 data URL (data:image/jpeg;base64,...) stored in Firestore
  imageFormat: 'image/jpeg'
  imageUrl: string             // Resolved display URL (compressedImage data URL)
  originalImageUrl?: string    // Optional local object URL when hydrated on guest device
  storageProvider: StorageProviderType
  isPublicStorage: boolean
  filename: string             // e.g., John_Doe_001.jpg
  originalFilename?: string    // e.g., John_Doe_001_orig.jpg
  capturedAt: string           // ISO 8601 (stored as Timestamp in Firestore)
  uploadedAt: string           // ISO 8601 (stored as Timestamp in Firestore)
  status: PhotoStatus          // "active" | "visible" | "hidden"
  uploadStatus?: LocalUploadStatus
  flashUsed: boolean
  facingMode: 'user' | 'environment'
  preset: FilmFilterPreset
  overlay?: FilmOverlayPreset
  width: number
  height: number
  sizeBytes: number
}

export interface UploadProgressInfo {
  step:
    | 'saving-local'
    | 'compressing'
    | 'validating-size'
    | 'uploading-firestore'
    | 'updating-counter'
    | 'completed'
  label: string
  percent: number
}

export interface StorageUploadPayload {
  processedBlob: Blob
  originalBlob?: Blob
  filename: string
  originalFilename?: string
  guestId: string
  shotNumber: number
}

export interface StorageUploadResult {
  imageUrl: string
  originalImageUrl?: string
  provider: StorageProviderType
  isPublic: boolean
  sizeBytes: number
}

export interface AdminDashboardStats {
  totalRegistrations: number
  confirmedAttendees: number
  notAttending: number
  totalPhotosSubmitted: number
  visiblePhotosCount: number
  hiddenPhotosCount: number
  totalShotsAllocated: number
  totalShotsUsed: number
  totalShotsRemaining: number
}
