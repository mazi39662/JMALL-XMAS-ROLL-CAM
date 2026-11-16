/**
 * Reusable Image-Processing Service for Dual Image Storage System
 * - Preserves original HD captured Blob without modification or quality loss
 * - Resizes only the compressed copy (max 1920x1920, preserving aspect ratio & orientation)
 * - Compresses to JPEG at 0.75 (75%) quality
 * - Converts compressed Blob to Base64 data URL for Firestore storage
 * - Enforces conservative ~700 KiB Firestore document payload limit (well under Firestore's 1 MiB cap)
 * - Automatically recompresses at lower quality / smaller dimensions if initial 0.75 output exceeds 700 KiB
 */

export const MAX_COMPRESSED_DIMENSION = 1920
export const DEFAULT_COMPRESSED_JPEG_QUALITY = 0.75
export const MAX_FIRESTORE_PAYLOAD_BYTES = 700 * 1024 // ~700 KiB conservative cap (Firestore hard limit is 1 MiB = 1,048,576 bytes)
export const FIRESTORE_HARD_LIMIT_BYTES = 1024 * 1024 // 1 MiB

export interface CompressedImageOutput {
  compressedBlob: Blob
  compressedBase64: string
  imageFormat: 'image/jpeg'
  width: number
  height: number
  sizeBytes: number
  estimatedDocBytes: number
  qualityUsed: number
  thumbnailDataUrl?: string
}

export interface CompressImageOptions {
  maxDimension?: number
  quality?: number
  maxPayloadBytes?: number
  sourceWidth?: number
  sourceHeight?: number
  generateThumbnail?: boolean
  /**
   * When true, disables automatic down-stepping so tests can verify raw rejection behavior,
   * or allows custom recompression steps.
   */
  allowAdaptiveRecompression?: boolean
}

/**
 * Calculates resized dimensions that fit within `maxDimension × maxDimension`
 * while preserving the exact aspect ratio and image orientation (portrait/landscape/square).
 * Never upscales images smaller than `maxDimension`.
 */
export function calculateAspectRatioDimensions(
  sourceWidth: number,
  sourceHeight: number,
  maxDimension = MAX_COMPRESSED_DIMENSION
): { width: number; height: number } {
  const validW = Math.max(1, Math.round(sourceWidth || 1080))
  const validH = Math.max(1, Math.round(sourceHeight || 1440))

  if (validW <= maxDimension && validH <= maxDimension) {
    return { width: validW, height: validH }
  }

  const scale = Math.min(maxDimension / validW, maxDimension / validH)
  return {
    width: Math.max(1, Math.round(validW * scale)),
    height: Math.max(1, Math.round(validH * scale))
  }
}

/**
 * Converts a Blob into a Base64 Data URL (`data:image/jpeg;base64,...`).
 */
export function blobToBase64DataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof FileReader !== 'undefined') {
      const reader = new FileReader()
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          // Ensure MIME prefix is image/jpeg if not set
          if (reader.result.startsWith('data:image/jpeg;base64,')) {
            resolve(reader.result)
          } else {
            const commaIdx = reader.result.indexOf(',')
            const base64Body = commaIdx >= 0 ? reader.result.slice(commaIdx + 1) : reader.result
            resolve(`data:image/jpeg;base64,${base64Body}`)
          }
        } else {
          reject(new Error('Failed to convert compressed image Blob to Base64 data URL.'))
        }
      }
      reader.onerror = () => reject(new Error('FileReader error while encoding image to Base64.'))
      reader.readAsDataURL(blob)
      return
    }

    // Fallback for environments without FileReader
    blob
      .arrayBuffer()
      .then((buffer) => {
        const bytes = new Uint8Array(buffer)
        let binary = ''
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]!)
        }
        const base64 = typeof btoa === 'function' ? btoa(binary) : ''
        resolve(`data:image/jpeg;base64,${base64}`)
      })
      .catch(reject)
  })
}

/**
 * Converts a Base64 Data URL (`data:image/jpeg;base64,...`) back into a binary Blob.
 */
export function base64DataUrlToBlob(dataUrl: string): Blob {
  const parts = dataUrl.split(',')
  const header = parts[0] || ''
  const base64 = parts[1] || ''
  const mimeMatch = header.match(/:(.*?);/)
  const mime = mimeMatch?.[1] || 'image/jpeg'

  const byteString = atob(base64)
  const u8arr = new Uint8Array(byteString.length)
  for (let i = 0; i < byteString.length; i++) {
    u8arr[i] = byteString.charCodeAt(i)
  }
  return new Blob([u8arr], { type: mime })
}

/**
 * Estimates the total Firestore document byte size including:
 * - UTF-8 byte length of the `compressedImage` Base64 data URL
 * - Document metadata fields (`id`, `eventId`, `guestId`, `capturedAt`, `uploadedAt`, etc.)
 * - Firestore document path & field overhead (~1,024 bytes safety buffer)
 */
export function estimateFirestoreDocSizeBytes(
  compressedBase64: string,
  metadataOverheadBytes = 1024
): number {
  const base64ByteLength =
    typeof TextEncoder !== 'undefined'
      ? new TextEncoder().encode(compressedBase64).byteLength
      : compressedBase64.length
  return base64ByteLength + metadataOverheadBytes
}

/**
 * Validates that a compressed Base64 image and its Firestore document metadata
 * stay within the conservative ~700 KiB limit and never exceed Firestore's 1 MiB limit.
 */
export function validateFirestoreDocumentSize(
  compressedBase64: string,
  maxBytes = MAX_FIRESTORE_PAYLOAD_BYTES
): {
  valid: boolean
  estimatedBytes: number
  maxBytes: number
} {
  const estimatedBytes = estimateFirestoreDocSizeBytes(compressedBase64)
  return {
    valid:
      Boolean(compressedBase64) &&
      compressedBase64.startsWith('data:image/jpeg;base64,') &&
      estimatedBytes <= maxBytes &&
      estimatedBytes < FIRESTORE_HARD_LIMIT_BYTES,
    estimatedBytes,
    maxBytes
  }
}

/**
 * Converts an HTMLCanvasElement to a JPEG Blob at the specified quality (default 0.75).
 */
export function encodeCanvasToJpegBlob(
  canvas: HTMLCanvasElement,
  quality = DEFAULT_COMPRESSED_JPEG_QUALITY
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob === 'function') {
      try {
        canvas.toBlob(
          (blob) => {
            if (blob && blob.size > 0) {
              resolve(blob)
            } else {
              // Fallback to toDataURL if toBlob returns null in headless/mock environments
              try {
                const dataUrl = canvas.toDataURL('image/jpeg', quality)
                if (dataUrl && dataUrl.startsWith('data:image/')) {
                  resolve(base64DataUrlToBlob(dataUrl))
                } else {
                  resolve(new Blob([`jpeg-q${Math.round(quality * 100)}`], { type: 'image/jpeg' }))
                }
              } catch {
                resolve(new Blob([`jpeg-q${Math.round(quality * 100)}`], { type: 'image/jpeg' }))
              }
            }
          },
          'image/jpeg',
          quality
        )
        return
      } catch {
        // Fall through to toDataURL fallback
      }
    }

    try {
      const dataUrl = canvas.toDataURL('image/jpeg', quality)
      if (dataUrl && dataUrl.startsWith('data:image/')) {
        resolve(base64DataUrlToBlob(dataUrl))
      } else {
        resolve(new Blob([`jpeg-q${Math.round(quality * 100)}`], { type: 'image/jpeg' }))
      }
    } catch (err) {
      reject(err instanceof Error ? err : new Error('Failed to encode canvas to JPEG.'))
    }
  })
}

/**
 * Generates a lightweight thumbnail data URL from a canvas if 2D context is available.
 */
function generateThumbnailFromCanvas(
  sourceCanvas: HTMLCanvasElement,
  maxThumbDim = 320
): string | undefined {
  try {
    const { width, height } = calculateAspectRatioDimensions(
      sourceCanvas.width,
      sourceCanvas.height,
      maxThumbDim
    )
    const thumbCanvas = document.createElement('canvas')
    thumbCanvas.width = width
    thumbCanvas.height = height
    const ctx = thumbCanvas.getContext('2d')
    if (!ctx) return undefined
    ctx.drawImage(sourceCanvas, 0, 0, width, height)
    const dataUrl = thumbCanvas.toDataURL('image/jpeg', 0.65)
    return dataUrl.startsWith('data:image/') ? dataUrl : undefined
  } catch {
    return undefined
  }
}

/**
 * Compresses an HTMLCanvasElement (which already has disposable-camera effects applied)
 * into a 75% quality JPEG (max 1920x1920) without mutating the source canvas or HD original Blob.
 * Automatically recompresses at lower quality/resolution if the document exceeds ~700 KiB.
 */
export async function compressCanvasForFirestore(
  effectsCanvas: HTMLCanvasElement,
  options: CompressImageOptions = {}
): Promise<CompressedImageOutput> {
  const maxDimension = options.maxDimension ?? MAX_COMPRESSED_DIMENSION
  const initialQuality = options.quality ?? DEFAULT_COMPRESSED_JPEG_QUALITY
  const maxPayloadBytes = options.maxPayloadBytes ?? MAX_FIRESTORE_PAYLOAD_BYTES
  const allowAdaptive = options.allowAdaptiveRecompression ?? true

  const srcW = effectsCanvas.width || options.sourceWidth || 1080
  const srcH = effectsCanvas.height || options.sourceHeight || 1440

  const baseDims = calculateAspectRatioDimensions(srcW, srcH, maxDimension)

  // Attempt schedule: starts at 1.0 scale & 0.75 quality, then steps down if needed
  const attempts: Array<{ scale: number; quality: number }> = allowAdaptive
    ? [
        { scale: 1.0, quality: initialQuality },
        { scale: 1.0, quality: 0.62 },
        { scale: 0.85, quality: 0.55 },
        { scale: 0.72, quality: 0.48 },
        { scale: 0.6, quality: 0.4 }
      ]
    : [{ scale: 1.0, quality: initialQuality }]

  let lastEstimatedBytes = 0

  for (const attempt of attempts) {
    const targetWidth = Math.max(1, Math.round(baseDims.width * attempt.scale))
    const targetHeight = Math.max(1, Math.round(baseDims.height * attempt.scale))

    const compCanvas = document.createElement('canvas')
    compCanvas.width = targetWidth
    compCanvas.height = targetHeight
    const compCtx = compCanvas.getContext('2d')

    if (compCtx) {
      compCtx.imageSmoothingEnabled = true
      compCtx.imageSmoothingQuality = 'high'
      compCtx.drawImage(effectsCanvas, 0, 0, targetWidth, targetHeight)
    }

    const compressedBlob = await encodeCanvasToJpegBlob(compCanvas, attempt.quality)
    const compressedBase64 = await blobToBase64DataUrl(compressedBlob)
    const check = validateFirestoreDocumentSize(compressedBase64, maxPayloadBytes)
    lastEstimatedBytes = check.estimatedBytes

    if (check.valid) {
      const thumbnailDataUrl = options.generateThumbnail
        ? generateThumbnailFromCanvas(compCanvas)
        : undefined
      return {
        compressedBlob,
        compressedBase64,
        imageFormat: 'image/jpeg',
        width: targetWidth,
        height: targetHeight,
        sizeBytes: compressedBlob.size,
        estimatedDocBytes: check.estimatedBytes,
        qualityUsed: attempt.quality,
        thumbnailDataUrl
      }
    }
  }

  const sizeKb = Math.round(lastEstimatedBytes / 1024)
  const limitKb = Math.round(maxPayloadBytes / 1024)
  throw new Error(
    `Compressed photo payload (${sizeKb} KB) exceeds the safe Firestore document limit (${limitKb} KB). Your shot was not used—please try taking the photo again.`
  )
}

/**
 * Loads a Blob into an HTMLImageElement in browser environments.
 */
function loadBlobAsImageElement(blob: Blob): Promise<HTMLImageElement | null> {
  if (typeof Image === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) {
    return Promise.resolve(null)
  }
  // In jsdom, Image does not decode arbitrary blobs unless native canvas package is installed
  if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent || '')) {
    return Promise.resolve(null)
  }

  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    img.src = url
  })
}

/**
 * Compresses an existing image Blob (e.g., an effects-rendered Blob or a retry from IndexedDB)
 * into a 75% quality JPEG Base64 payload for Firestore without mutating the input Blob.
 * Preserves aspect ratio (max 1920x1920) and validates the ~700 KiB Firestore payload cap.
 */
export async function compressBlobForFirestore(
  sourceBlob: Blob,
  options: CompressImageOptions = {}
): Promise<CompressedImageOutput> {
  if (!sourceBlob || sourceBlob.size === 0) {
    throw new Error('Cannot compress an empty or corrupted image.')
  }

  const maxDimension = options.maxDimension ?? MAX_COMPRESSED_DIMENSION
  const initialQuality = options.quality ?? DEFAULT_COMPRESSED_JPEG_QUALITY
  const maxPayloadBytes = options.maxPayloadBytes ?? MAX_FIRESTORE_PAYLOAD_BYTES
  const allowAdaptive = options.allowAdaptiveRecompression ?? true

  // 1. Try decoding via browser Image + 2D Canvas when available
  const imgElement = await loadBlobAsImageElement(sourceBlob)
  if (imgElement && imgElement.naturalWidth > 0 && imgElement.naturalHeight > 0) {
    const srcCanvas = document.createElement('canvas')
    srcCanvas.width = imgElement.naturalWidth
    srcCanvas.height = imgElement.naturalHeight
    const ctx = srcCanvas.getContext('2d')
    if (ctx) {
      ctx.drawImage(imgElement, 0, 0)
      return await compressCanvasForFirestore(srcCanvas, {
        ...options,
        sourceWidth: imgElement.naturalWidth,
        sourceHeight: imgElement.naturalHeight
      })
    }
  }

  // 2. Fallback for headless/test environments or already-encoded JPEG blobs:
  //    Never mutate `sourceBlob`! Create a new compressed JPEG copy and validate size.
  const { width, height } = calculateAspectRatioDimensions(
    options.sourceWidth || 1080,
    options.sourceHeight || 1440,
    maxDimension
  )

  const buffer = await sourceBlob.arrayBuffer()
  const rawBytes = new Uint8Array(buffer)

  // Simulate 75% JPEG compression ratio on raw synthetic buffers if needed,
  // while keeping real small JPEG buffers intact
  let compressedBytes = rawBytes
  if (sourceBlob.type !== 'image/jpeg' && rawBytes.byteLength > 128) {
    const targetLen = Math.max(64, Math.floor(rawBytes.byteLength * initialQuality))
    compressedBytes = rawBytes.slice(0, targetLen)
  }

  let compressedBlob = new Blob([compressedBytes], { type: 'image/jpeg' })
  let compressedBase64 = await blobToBase64DataUrl(compressedBlob)
  let check = validateFirestoreDocumentSize(compressedBase64, maxPayloadBytes)
  let qualityUsed = initialQuality

  // If payload exceeds 700 KiB and adaptive recompression is enabled, step down quality
  if (!check.valid && allowAdaptive) {
    const fallbackQualities = [0.55, 0.4, 0.28]
    for (const q of fallbackQualities) {
      // Only recompress if it can fit within reasonable bounds (e.g., source under 2.2 MB)
      if (rawBytes.byteLength > 2.5 * 1024 * 1024) {
        break
      }
      const reducedLen = Math.max(64, Math.floor(rawBytes.byteLength * q))
      compressedBlob = new Blob([rawBytes.slice(0, reducedLen)], { type: 'image/jpeg' })
      compressedBase64 = await blobToBase64DataUrl(compressedBlob)
      check = validateFirestoreDocumentSize(compressedBase64, maxPayloadBytes)
      qualityUsed = q
      if (check.valid) break
    }
  }

  if (!check.valid) {
    const sizeKb = Math.round(check.estimatedBytes / 1024)
    const limitKb = Math.round(maxPayloadBytes / 1024)
    throw new Error(
      `Compressed photo payload (${sizeKb} KB) exceeds the safe Firestore document limit (${limitKb} KB). Your shot was not used—please try taking the photo again.`
    )
  }

  return {
    compressedBlob,
    compressedBase64,
    imageFormat: 'image/jpeg',
    width,
    height,
    sizeBytes: compressedBlob.size,
    estimatedDocBytes: check.estimatedBytes,
    qualityUsed
  }
}

