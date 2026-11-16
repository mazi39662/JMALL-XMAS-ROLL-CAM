import JSZip from 'jszip'
import type { PhotoRecord } from '@/types'
import { formatGuestPhotoFilename } from './repository'
import { getOriginalPhoto } from './indexedDbStorage'

export interface ZipExportOptions {
  organizeByGuestFolder: boolean
  includeTimestampInFilename: boolean
  includeOriginals?: boolean
  eventName?: string
  onProgress?: (completed: number, total: number) => void
}

function formatCompactTimestamp(isoString: string): string {
  const d = new Date(isoString)
  if (Number.isNaN(d.getTime())) return '20261219'
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${yyyy}${mm}${dd}-${hh}${min}`
}

export function buildExportFilename(
  photo: PhotoRecord,
  includeTimestamp = false,
  isOriginal = false
): string {
  const timePart = includeTimestamp ? `_${formatCompactTimestamp(photo.capturedAt)}` : ''
  const origPart = isOriginal ? '_ORIGINAL' : ''
  return formatGuestPhotoFilename(photo.guestName, photo.shotNumber, `${timePart}${origPart}`)
}

export async function fetchImageAsBlob(url: string): Promise<Blob> {
  if (!url) {
    throw new Error('Photo image data is empty.')
  }
  if (url.startsWith('data:')) {
    const parts = url.split(',')
    const mimeMatch = parts[0]?.match(/:(.*?);/)
    const mime = mimeMatch?.[1] || 'image/jpeg'
    const bstr = atob(parts[1] || '')
    const u8arr = new Uint8Array(bstr.length)
    for (let i = 0; i < bstr.length; i++) {
      u8arr[i] = bstr.charCodeAt(i)
    }
    return new Blob([u8arr], { type: mime })
  }

  const response = await fetch(url, { mode: 'cors' })
  if (!response.ok) {
    throw new Error(`Failed to fetch photo (${response.status} ${response.statusText})`)
  }
  return await response.blob()
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) {
    return
  }
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(objectUrl), 4000)
}

export async function downloadSinglePhoto(
  photo: PhotoRecord,
  options: { includeTimestamp?: boolean; useOriginal?: boolean } = {}
): Promise<string> {
  if (options.useOriginal) {
    const localRecord = await getOriginalPhoto(photo.id)
    if (localRecord && localRecord.imageBlob && localRecord.imageBlob.size > 0) {
      const filename = buildExportFilename(photo, Boolean(options.includeTimestamp), true)
      triggerBlobDownload(localRecord.imageBlob, filename)
      return filename
    }
    if (photo.originalImageUrl) {
      const filename = buildExportFilename(photo, Boolean(options.includeTimestamp), true)
      const blob = await fetchImageAsBlob(photo.originalImageUrl)
      triggerBlobDownload(blob, filename)
      return filename
    }
    throw new Error(
      'HD Original is not stored on this device. HD originals are only available on the device where the photo was taken.'
    )
  }

  const targetUrl = photo.compressedImage || photo.imageUrl
  const filename = buildExportFilename(photo, Boolean(options.includeTimestamp), false)
  const blob = await fetchImageAsBlob(targetUrl)
  triggerBlobDownload(blob, filename)
  return filename
}

export async function generateEventPhotosZipBlob(
  photos: PhotoRecord[],
  options: ZipExportOptions
): Promise<{ zipBlob: Blob; exportedCount: number; filenames: string[] }> {
  if (!photos.length) {
    throw new Error('No photos selected for export.')
  }

  const zip = new JSZip()
  const exportedFilenames: string[] = []
  let completed = 0
  const total = photos.length

  const summaryLines: string[] = [
    `============================================================`,
    `XMAS ROLL — EVENT PHOTO ARCHIVE MANIFEST`,
    `Event: ${options.eventName || 'JMALL XMAS ROLL 2026'}`,
    `Exported At: ${new Date().toISOString()}`,
    `Total Photos: ${photos.length}`,
    `Storage Mode: Firestore Compressed JPEG (75% Quality)`,
    `============================================================`,
    ``
  ]

  for (const photo of photos) {
    const guestFolderSlug =
      photo.guestName
        .trim()
        .replace(/[^a-zA-Z0-9\s]+/g, '')
        .trim()
        .replace(/\s+/g, '_') || 'Guest'

    const processedFilename = buildExportFilename(
      photo,
      options.includeTimestampInFilename,
      false
    )
    const processedPath = options.organizeByGuestFolder
      ? `${guestFolderSlug}/${processedFilename}`
      : processedFilename

    const sourceDataUrl = photo.compressedImage || photo.imageUrl
    const processedBlob = await fetchImageAsBlob(sourceDataUrl)
    zip.file(processedPath, processedBlob)
    exportedFilenames.push(processedPath)

    summaryLines.push(
      `[${String(photo.shotNumber).padStart(2, '0')}/10] ${processedPath} | Guest: ${photo.guestName} (${photo.department}) | Captured: ${photo.capturedAt} | Size: ${photo.sizeBytes} bytes`
    )

    if (options.includeOriginals) {
      try {
        let origBlob: Blob | null = null
        if (photo.originalImageUrl) {
          origBlob = await fetchImageAsBlob(photo.originalImageUrl)
        } else {
          const localOrig = await getOriginalPhoto(photo.id)
          if (localOrig?.imageBlob) {
            origBlob = localOrig.imageBlob
          }
        }

        if (origBlob) {
          const origFilename = buildExportFilename(
            photo,
            options.includeTimestampInFilename,
            true
          )
          const origPath = options.organizeByGuestFolder
            ? `${guestFolderSlug}/originals/${origFilename}`
            : `originals/${origFilename}`

          zip.file(origPath, origBlob)
          exportedFilenames.push(origPath)
        }
      } catch (err) {
        console.warn(`[XMAS ROLL] Could not include local original for ${photo.filename}:`, err)
      }
    }

    completed++
    options.onProgress?.(completed, total)
  }

  zip.file('XMAS_ROLL_MANIFEST.txt', summaryLines.join('\n'))

  const zipBlob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  })

  return {
    zipBlob,
    exportedCount: exportedFilenames.length,
    filenames: exportedFilenames
  }
}

export async function downloadEventPhotosAsZip(
  photos: PhotoRecord[],
  options: ZipExportOptions
): Promise<{ exportedCount: number; filenames: string[] }> {
  const result = await generateEventPhotosZipBlob(photos, options)
  const dateTag = new Date().toISOString().slice(0, 10)
  const zipFilename = `XMAS_ROLL_Photos_${dateTag}.zip`
  triggerBlobDownload(result.zipBlob, zipFilename)
  return {
    exportedCount: result.exportedCount,
    filenames: result.filenames
  }
}
