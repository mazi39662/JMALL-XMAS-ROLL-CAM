import type {
  StorageProviderType,
  StorageUploadPayload,
  StorageUploadResult
} from '@/types'
import {
  compressBlobForFirestore,
  DEFAULT_COMPRESSED_JPEG_QUALITY,
  MAX_COMPRESSED_DIMENSION,
  MAX_FIRESTORE_PAYLOAD_BYTES,
  validateFirestoreDocumentSize
} from './imageProcessor'

const MAX_IMAGE_SIZE_BYTES = 20 * 1024 * 1024 // 20 MB raw input limit before compression
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export interface IStorageProvider {
  readonly name: StorageProviderType
  readonly isPubliclyAccessible: boolean
  readonly statusDescription: string
  uploadPhoto(payload: StorageUploadPayload): Promise<StorageUploadResult>
}

export function validateImageBlob(blob: Blob, label = 'Image'): void {
  if (!blob || blob.size === 0) {
    throw new Error(`${label} is empty or corrupted.`)
  }
  if (blob.type && !ALLOWED_MIME_TYPES.includes(blob.type)) {
    throw new Error(
      `Invalid file format (${blob.type}). Allowed formats: JPEG, PNG, WebP.`
    )
  }
  if (blob.size > MAX_IMAGE_SIZE_BYTES) {
    const sizeMb = (blob.size / (1024 * 1024)).toFixed(2)
    throw new Error(`${label} size (${sizeMb} MB) exceeds the 20 MB limit.`)
  }
}

/**
 * PRIMARY DUAL-STORAGE ADAPTER: FIRESTORE COMPRESSED BASE64 + LOCAL INDEXEDDB HD ORIGINALS
 * - Compresses the disposable-camera processed image to 75% JPEG (max 1920x1920)
 * - Encodes as Base64 data URL (`data:image/jpeg;base64,...`)
 * - Validates conservative ~700 KiB Firestore document limit (under 1 MiB hard cap)
 * - Never uploads the HD original to Firestore (HD original stays in device IndexedDB)
 */
class FirestoreCompressedStorageAdapter implements IStorageProvider {
  readonly name: StorageProviderType = 'firestore'
  readonly isPubliclyAccessible = true
  readonly statusDescription =
    'Dual Storage Active — Firestore Compressed JPEG (75% Base64) + Local IndexedDB HD Originals'

  async uploadPhoto(payload: StorageUploadPayload): Promise<StorageUploadResult> {
    validateImageBlob(payload.processedBlob, 'Processed photo')

    const compressed = await compressBlobForFirestore(payload.processedBlob, {
      maxDimension: MAX_COMPRESSED_DIMENSION,
      quality: DEFAULT_COMPRESSED_JPEG_QUALITY,
      maxPayloadBytes: MAX_FIRESTORE_PAYLOAD_BYTES,
      allowAdaptiveRecompression: true
    })

    const sizeCheck = validateFirestoreDocumentSize(
      compressed.compressedBase64,
      MAX_FIRESTORE_PAYLOAD_BYTES
    )
    if (!sizeCheck.valid) {
      const kb = Math.round(sizeCheck.estimatedBytes / 1024)
      throw new Error(
        `Photo size (${kb} KB) exceeds Firestore's safe 700 KB limit. Shot was not used.`
      )
    }

    return {
      imageUrl: compressed.compressedBase64,
      provider: 'firestore',
      isPublic: true,
      sizeBytes: compressed.sizeBytes
    }
  }
}

/**
 * Factory resolver that returns the active Storage Provider.
 * Defaults to FirestoreCompressedStorageAdapter (Dual Storage: Firestore Compressed Base64 + IndexedDB HD Originals).
 */
export function getStorageProvider(): IStorageProvider {
  return new FirestoreCompressedStorageAdapter()
}
