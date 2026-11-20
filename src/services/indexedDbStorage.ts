import JSZip from 'jszip'
import type { LocalOriginalPhotoRecord, LocalUploadStatus, PhotoRecord } from '@/types'

/**
 * Dedicated IndexedDB Local Storage Service for HD Originals
 * Database: xmas_roll_db
 * Object Store: original_photos
 * Fallback Object Store (when Firebase is not configured): local_firestore_photos
 *
 * Preserves full-resolution HD original Blobs locally on the guest's device.
 * Never uses localStorage for binary image storage.
 */

export const IDB_DATABASE_NAME = 'xmas_roll_db'
export const IDB_DATABASE_VERSION = 2
export const ORIGINAL_PHOTOS_STORE = 'original_photos'
export const LOCAL_FIRESTORE_PHOTOS_STORE = 'local_firestore_photos'

export class IndexedDbUnavailableError extends Error {
  constructor(
    message = 'Local device storage (IndexedDB) is unavailable in this browser. Please disable private browsing or enable browser storage to save HD photos.'
  ) {
    super(message)
    this.name = 'IndexedDbUnavailableError'
  }
}

export class InsufficientLocalStorageError extends Error {
  constructor(
    message = 'Insufficient local device storage to save your HD original photo. Please free up storage space on your device and try again.'
  ) {
    super(message)
    this.name = 'InsufficientLocalStorageError'
  }
}

export function isIndexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null && typeof indexedDB.open === 'function'
  } catch {
    return false
  }
}

function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const name = (err as { name?: string }).name || ''
  const message = (err as { message?: string }).message || ''
  return (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    /quota/i.test(name) ||
    /quota|storage full|insufficient/i.test(message)
  )
}

/**
 * Opens a connection to the `xmas_roll_db` IndexedDB database and ensures
 * the `original_photos` object store and its indexes exist.
 */
export function openXmasRollDatabase(): Promise<IDBDatabase> {
  if (!isIndexedDbAvailable()) {
    return Promise.reject(new IndexedDbUnavailableError())
  }

  return new Promise((resolve, reject) => {
    try {
      const request = indexedDB.open(IDB_DATABASE_NAME, IDB_DATABASE_VERSION)

      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(ORIGINAL_PHOTOS_STORE)) {
          const store = db.createObjectStore(ORIGINAL_PHOTOS_STORE, { keyPath: 'id' })
          store.createIndex('by_guestId', 'guestId', { unique: false })
          store.createIndex('by_eventId', 'eventId', { unique: false })
          store.createIndex('by_photoId', 'photoId', { unique: false })
          store.createIndex('by_uploadStatus', 'uploadStatus', { unique: false })
        }
        if (!db.objectStoreNames.contains(LOCAL_FIRESTORE_PHOTOS_STORE)) {
          db.createObjectStore(LOCAL_FIRESTORE_PHOTOS_STORE, { keyPath: 'id' })
        }
      }

      request.onsuccess = () => {
        resolve(request.result)
      }

      request.onerror = () => {
        const err = request.error
        if (isQuotaError(err)) {
          reject(new InsufficientLocalStorageError())
        } else {
          reject(new IndexedDbUnavailableError(err?.message || 'Failed to open IndexedDB database.'))
        }
      }
    } catch (err) {
      if (isQuotaError(err)) {
        reject(new InsufficientLocalStorageError())
      } else {
        reject(
          new IndexedDbUnavailableError(
            err instanceof Error ? err.message : 'IndexedDB is unavailable.'
          )
        )
      }
    }
  })
}

export interface SaveOriginalPhotoInput {
  id?: string
  eventId: string
  guestId: string
  photoId: string
  imageBlob: Blob
  capturedAt: string
  uploadStatus?: LocalUploadStatus
  sessionId?: string
  shotNumber?: number
  filename?: string
  width?: number
  height?: number
  flashUsed?: boolean
  facingMode?: 'user' | 'environment'
  preset?: LocalOriginalPhotoRecord['preset']
  overlay?: LocalOriginalPhotoRecord['overlay']
}

/**
 * 1. saveOriginalPhoto()
 * Saves the uncompressed HD original photo Blob into `xmas_roll_db.original_photos`.
 * Does not compress or modify the original Blob.
 */
export async function saveOriginalPhoto(
  input: SaveOriginalPhotoInput
): Promise<LocalOriginalPhotoRecord> {
  if (!input.imageBlob || input.imageBlob.size === 0) {
    throw new Error('Cannot save an empty HD original image Blob to IndexedDB.')
  }

  // Optional StorageManager quota check when supported by browser
  if (
    typeof navigator !== 'undefined' &&
    navigator.storage &&
    typeof navigator.storage.estimate === 'function'
  ) {
    try {
      const estimate = await navigator.storage.estimate()
      if (
        typeof estimate.quota === 'number' &&
        typeof estimate.usage === 'number' &&
        estimate.quota > 0 &&
        estimate.quota - estimate.usage < input.imageBlob.size + 512 * 1024
      ) {
        throw new InsufficientLocalStorageError()
      }
    } catch (err) {
      if (err instanceof InsufficientLocalStorageError) throw err
    }
  }

  const record: LocalOriginalPhotoRecord = {
    id: input.id || input.photoId,
    eventId: input.eventId,
    guestId: input.guestId,
    photoId: input.photoId,
    imageBlob: input.imageBlob,
    capturedAt: input.capturedAt,
    uploadStatus: input.uploadStatus || 'pending',
    sessionId: input.sessionId,
    shotNumber: input.shotNumber,
    filename: input.filename,
    width: input.width,
    height: input.height,
    flashUsed: input.flashUsed,
    facingMode: input.facingMode,
    preset: input.preset,
    overlay: input.overlay
  }

  const db = await openXmasRollDatabase()
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(ORIGINAL_PHOTOS_STORE, 'readwrite')
      const store = tx.objectStore(ORIGINAL_PHOTOS_STORE)
      const req = store.put(record)

      req.onerror = () => {
        if (isQuotaError(req.error)) {
          reject(new InsufficientLocalStorageError())
        } else {
          reject(new Error(req.error?.message || 'Failed to write HD original photo to IndexedDB.'))
        }
      }

      tx.oncomplete = () => {
        db.close()
        resolve(record)
      }

      tx.onerror = () => {
        db.close()
        if (isQuotaError(tx.error)) {
          reject(new InsufficientLocalStorageError())
        } else {
          reject(new Error(tx.error?.message || 'IndexedDB write transaction failed.'))
        }
      }

      tx.onabort = () => {
        db.close()
        if (isQuotaError(tx.error)) {
          reject(new InsufficientLocalStorageError())
        } else {
          reject(new Error('IndexedDB transaction was aborted while saving HD original.'))
        }
      }
    } catch (err) {
      db.close()
      if (isQuotaError(err)) {
        reject(new InsufficientLocalStorageError())
      } else {
        reject(err instanceof Error ? err : new Error('Failed to save HD original to IndexedDB.'))
      }
    }
  })
}

/**
 * 2. getOriginalPhoto()
 * Retrieves a single HD original record by its `id` or `photoId`.
 */
export async function getOriginalPhoto(
  photoIdOrId: string
): Promise<LocalOriginalPhotoRecord | null> {
  if (!photoIdOrId) return null
  if (!isIndexedDbAvailable()) return null

  const db = await openXmasRollDatabase()
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(ORIGINAL_PHOTOS_STORE, 'readonly')
      const store = tx.objectStore(ORIGINAL_PHOTOS_STORE)
      const directReq = store.get(photoIdOrId)

      directReq.onsuccess = () => {
        if (directReq.result) {
          db.close()
          resolve(directReq.result as LocalOriginalPhotoRecord)
          return
        }

        // Fallback: search by photoId if `id` differed from `photoId`
        const allReq = store.getAll()
        allReq.onsuccess = () => {
          db.close()
          const all = (allReq.result || []) as LocalOriginalPhotoRecord[]
          const match = all.find((r) => r.photoId === photoIdOrId || r.id === photoIdOrId) || null
          resolve(match)
        }
        allReq.onerror = () => {
          db.close()
          resolve(null)
        }
      }

      directReq.onerror = () => {
        db.close()
        reject(new Error(directReq.error?.message || 'Failed to read HD original from IndexedDB.'))
      }
    } catch (err) {
      db.close()
      reject(err instanceof Error ? err : new Error('Failed to read HD original from IndexedDB.'))
    }
  })
}

/**
 * 3. getGuestPhotos()
 * Returns all locally stored HD original records for a specific guest (and optional eventId),
 * sorted chronologically by capture time / shot number.
 */
export async function getGuestPhotos(
  guestId: string,
  eventId?: string
): Promise<LocalOriginalPhotoRecord[]> {
  if (!guestId || !isIndexedDbAvailable()) return []

  const db = await openXmasRollDatabase()
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(ORIGINAL_PHOTOS_STORE, 'readonly')
      const store = tx.objectStore(ORIGINAL_PHOTOS_STORE)
      const req = store.getAll()

      req.onsuccess = () => {
        db.close()
        const all = (req.result || []) as LocalOriginalPhotoRecord[]
        const filtered = all
          .filter((r) => r.guestId === guestId && (!eventId || r.eventId === eventId))
          .sort((a, b) => {
            if (typeof a.shotNumber === 'number' && typeof b.shotNumber === 'number') {
              return a.shotNumber - b.shotNumber
            }
            return a.capturedAt.localeCompare(b.capturedAt)
          })
        resolve(filtered)
      }

      req.onerror = () => {
        db.close()
        reject(new Error(req.error?.message || 'Failed to list guest HD photos from IndexedDB.'))
      }
    } catch (err) {
      db.close()
      reject(err instanceof Error ? err : new Error('Failed to list guest HD photos.'))
    }
  })
}

/**
 * 4. updateUploadStatus()
 * Updates the `uploadStatus` ("pending" | "uploaded") of a locally stored HD original.
 * Preserves the HD `imageBlob` in IndexedDB even after upload completes.
 */
export async function updateUploadStatus(
  photoIdOrId: string,
  uploadStatus: LocalUploadStatus
): Promise<LocalOriginalPhotoRecord | null> {
  const existing = await getOriginalPhoto(photoIdOrId)
  if (!existing) return null

  const updated: LocalOriginalPhotoRecord = {
    ...existing,
    uploadStatus
  }

  const db = await openXmasRollDatabase()
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(ORIGINAL_PHOTOS_STORE, 'readwrite')
      const store = tx.objectStore(ORIGINAL_PHOTOS_STORE)
      store.put(updated)

      tx.oncomplete = () => {
        db.close()
        resolve(updated)
      }

      tx.onerror = () => {
        db.close()
        reject(new Error(tx.error?.message || 'Failed to update uploadStatus in IndexedDB.'))
      }
    } catch (err) {
      db.close()
      reject(err instanceof Error ? err : new Error('Failed to update uploadStatus in IndexedDB.'))
    }
  })
}

/**
 * 5. deleteOriginalPhoto()
 * Deletes a record from `original_photos` by `id` or `photoId` (used only when guest explicitly discards an unsubmitted failed shot).
 */
export async function deleteOriginalPhoto(photoIdOrId: string): Promise<void> {
  if (!photoIdOrId || !isIndexedDbAvailable()) return

  const existing = await getOriginalPhoto(photoIdOrId)
  const targetKey = existing?.id || photoIdOrId

  const db = await openXmasRollDatabase()
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(ORIGINAL_PHOTOS_STORE, 'readwrite')
      const store = tx.objectStore(ORIGINAL_PHOTOS_STORE)
      store.delete(targetKey)

      tx.oncomplete = () => {
        db.close()
        resolve()
      }

      tx.onerror = () => {
        db.close()
        reject(new Error(tx.error?.message || 'Failed to delete HD photo from IndexedDB.'))
      }
    } catch (err) {
      db.close()
      reject(err instanceof Error ? err : new Error('Failed to delete HD photo from IndexedDB.'))
    }
  })
}

/**
 * 6. getPendingUploads()
 * Retrieves all locally stored HD original photos whose `uploadStatus === "pending"`,
 * optionally filtered by `guestId` and `eventId`.
 */
export async function getPendingUploads(
  guestId?: string,
  eventId?: string
): Promise<LocalOriginalPhotoRecord[]> {
  if (!isIndexedDbAvailable()) return []

  const db = await openXmasRollDatabase()
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(ORIGINAL_PHOTOS_STORE, 'readonly')
      const store = tx.objectStore(ORIGINAL_PHOTOS_STORE)
      const req = store.getAll()

      req.onsuccess = () => {
        db.close()
        const all = (req.result || []) as LocalOriginalPhotoRecord[]
        const pending = all
          .filter(
            (r) =>
              r.uploadStatus === 'pending' &&
              (!guestId || r.guestId === guestId) &&
              (!eventId || r.eventId === eventId)
          )
          .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
        resolve(pending)
      }

      req.onerror = () => {
        db.close()
        reject(new Error(req.error?.message || 'Failed to query pending uploads from IndexedDB.'))
      }
    } catch (err) {
      db.close()
      reject(err instanceof Error ? err : new Error('Failed to query pending uploads.'))
    }
  })
}

/**
 * Helper: Triggers a browser download for a single HD original stored in IndexedDB.
 * Throws an understandable error if the HD original is missing on this device.
 */
export async function downloadOriginalPhotoFromIndexedDb(
  photoId: string,
  fallbackFilename?: string
): Promise<{ filename: string; sizeBytes: number }> {
  const record = await getOriginalPhoto(photoId)
  if (!record || !record.imageBlob || record.imageBlob.size === 0) {
    throw new Error(
      'HD Original is not available on this device. Original high-resolution photos are stored locally on the device where they were taken.'
    )
  }

  const baseName = (fallbackFilename || record.filename || `${record.photoId}.jpg`).replace(
    /\.[^/.]+$/,
    ''
  )
  const ext = record.imageBlob.type === 'image/png' ? 'png' : 'jpg'
  const downloadName = baseName.endsWith('_HD') ? `${baseName}.${ext}` : `${baseName}_HD.${ext}`

  if (typeof document !== 'undefined' && typeof URL !== 'undefined' && URL.createObjectURL) {
    const objectUrl = URL.createObjectURL(record.imageBlob)
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = downloadName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    setTimeout(() => URL.revokeObjectURL(objectUrl), 4000)
  }

  return {
    filename: downloadName,
    sizeBytes: record.imageBlob.size
  }
}

/**
 * Helper: Generates a ZIP Blob containing all locally stored HD originals for a guest.
 * Throws a clear error if no local HD originals are found on this device.
 */
export async function generateGuestHdOriginalsZipBlob(
  guestId: string,
  guestName: string,
  eventId?: string,
  onProgress?: (completed: number, total: number) => void
): Promise<{ zipBlob: Blob; exportedCount: number; filenames: string[] }> {
  const records = await getGuestPhotos(guestId, eventId)
  if (!records.length) {
    throw new Error(
      'No HD original photos were found on this device. HD originals are saved locally on the device used to capture them.'
    )
  }

  const zip = new JSZip()
  const filenames: string[] = []
  const cleanGuestSlug =
    guestName
      .trim()
      .replace(/[^a-zA-Z0-9\s]+/g, '')
      .trim()
      .replace(/\s+/g, '_') || 'Guest'

  let completed = 0
  const total = records.length

  for (let i = 0; i < records.length; i++) {
    const rec = records[i]!
    const shotNum = rec.shotNumber ?? i + 1
    const paddedShot = String(shotNum).padStart(3, '0')
    const ext = rec.imageBlob.type === 'image/png' ? 'png' : 'jpg'
    const fileName = `${cleanGuestSlug}_${paddedShot}_HD.${ext}`

    zip.file(fileName, rec.imageBlob)
    filenames.push(fileName)

    completed++
    onProgress?.(completed, total)
  }

  const zipBlob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  })

  return {
    zipBlob,
    exportedCount: filenames.length,
    filenames
  }
}

/**
 * Helper: Downloads all locally stored HD originals for a guest as a ZIP archive.
 */
export async function downloadAllGuestHdOriginalsAsZip(
  guestId: string,
  guestName: string,
  eventId?: string,
  onProgress?: (completed: number, total: number) => void
): Promise<{ exportedCount: number; filenames: string[] }> {
  const result = await generateGuestHdOriginalsZipBlob(guestId, guestName, eventId, onProgress)
  const cleanGuestSlug =
    guestName
      .trim()
      .replace(/[^a-zA-Z0-9\s]+/g, '')
      .trim()
      .replace(/\s+/g, '_') || 'Guest'
  const zipFilename = `XMAS_ROLL_${cleanGuestSlug}_HD_Originals.zip`

  if (typeof document !== 'undefined' && typeof URL !== 'undefined' && URL.createObjectURL) {
    const objectUrl = URL.createObjectURL(result.zipBlob)
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = zipFilename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    setTimeout(() => URL.revokeObjectURL(objectUrl), 4000)
  }

  return {
    exportedCount: result.exportedCount,
    filenames: result.filenames
  }
}

/**
 * Persists a compressed PhotoRecord in IndexedDB when testing locally without Firebase configured.
 */
export async function saveLocalFallbackPhotoRecord(photo: PhotoRecord): Promise<void> {
  if (!isIndexedDbAvailable()) return
  try {
    const db = await openXmasRollDatabase()
    await new Promise<void>((resolve) => {
      const tx = db.transaction(LOCAL_FIRESTORE_PHOTOS_STORE, 'readwrite')
      tx.objectStore(LOCAL_FIRESTORE_PHOTOS_STORE).put(photo)
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => {
        db.close()
        resolve()
      }
    })
  } catch {
    // Ignore fallback persistence errors if IndexedDB is disabled
  }
}

/**
 * Loads all compressed PhotoRecords from IndexedDB when testing locally without Firebase configured.
 */
export async function getAllLocalFallbackPhotoRecords(): Promise<PhotoRecord[]> {
  if (!isIndexedDbAvailable()) return []
  try {
    const db = await openXmasRollDatabase()
    return await new Promise<PhotoRecord[]>((resolve) => {
      const tx = db.transaction(LOCAL_FIRESTORE_PHOTOS_STORE, 'readonly')
      const req = tx.objectStore(LOCAL_FIRESTORE_PHOTOS_STORE).getAll()
      req.onsuccess = () => {
        db.close()
        resolve((req.result || []) as PhotoRecord[])
      }
      req.onerror = () => {
        db.close()
        resolve([])
      }
    })
  } catch {
    return []
  }
}

/**
 * Clears all records in `xmas_roll_db` (used in unit/integration test resets).
 */
export async function clearIndexedDbForTesting(): Promise<void> {
  if (!isIndexedDbAvailable()) return
  try {
    const db = await openXmasRollDatabase()
    await new Promise<void>((resolve) => {
      const tx = db.transaction(ORIGINAL_PHOTOS_STORE, 'readwrite')
      tx.objectStore(ORIGINAL_PHOTOS_STORE).clear()
      tx.oncomplete = () => {
        const tx2 = db.transaction(LOCAL_FIRESTORE_PHOTOS_STORE, 'readwrite')
        tx2.objectStore(LOCAL_FIRESTORE_PHOTOS_STORE).clear()
        tx2.oncomplete = () => {
          db.close()
          resolve()
        }
        tx2.onerror = () => {
          db.close()
          resolve()
        }
      }
      tx.onerror = () => {
        db.close()
        resolve()
      }
    })
  } catch {
    // Ignore cleanup errors when IndexedDB is intentionally mocked out
  }
}

