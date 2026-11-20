import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearLocalDatabaseForTesting,
  fetchAllGuestsForAdmin,
  fetchAllPhotosForAdmin,
  fetchCameraSessionById,
  fetchGuestPhotos,
  formatGuestPhotoFilename,
  reconcileAndGetPendingUploads,
  recoverGuestSession,
  registerGuest,
  retryPendingPhotoUpload,
  submitCapturedPhoto,
  updateEventSettings,
  updatePhotoModerationStatus
} from '@/services/repository'
import {
  clearIndexedDbForTesting,
  deleteOriginalPhoto,
  downloadOriginalPhotoFromIndexedDb,
  generateGuestHdOriginalsZipBlob,
  getGuestPhotos,
  getOriginalPhoto,
  getPendingUploads,
  saveOriginalPhoto,
  updateUploadStatus
} from '@/services/indexedDbStorage'
import {
  calculateAspectRatioDimensions,
  compressBlobForFirestore,
  DEFAULT_COMPRESSED_JPEG_QUALITY,
  MAX_COMPRESSED_DIMENSION,
  MAX_FIRESTORE_PAYLOAD_BYTES,
  validateFirestoreDocumentSize
} from '@/services/imageProcessor'
import * as storageAdapterModule from '@/services/storageAdapter'
import { buildExportFilename, generateEventPhotosZipBlob } from '@/services/zipExporter'
import {
  signInAdmin,
  signInAdminWithGoogle,
  signInGuestWithGoogle,
  signOutAdmin
} from '@/services/adminAuth'
import { firebaseConfig, googleProvider } from '@/services/firebase'
import {
   computeCenterCrop3x2,
  formatDisposableDateStamp
} from '@/services/filmProcessor'

function createValidJpegBlob(content = 'fake-jpeg-binary-content'): Blob {
  return new Blob([content], { type: 'image/jpeg' })
}

describe('XMAS ROLL — End-to-End Domain & Dual Image Storage Verification', () => {
  beforeEach(async () => {
    clearLocalDatabaseForTesting()
    await clearIndexedDbForTesting()
    sessionStorage.clear()
    vi.restoreAllMocks()
  })

  it('1. Registers a guest with exactly 10 shots and persists camera session', async () => {
    const { guest, session } = await registerGuest({
      fullName: 'John Doe',
      contactNumber: '09171234567',
      email: 'john.doe@example.com',
      department: 'Marketing',
      attendance: 'attending',
      mediaAgreement: true
    })

    expect(guest.fullName).toBe('John Doe')
    expect(guest.totalShots).toBe(10)
    expect(guest.usedShots).toBe(0)
    expect(session.totalShots).toBe(10)
    expect(session.usedShots).toBe(0)
    expect(session.guestId).toBe(guest.id)
  })

  it('2. Prevents duplicate guest registrations by name, email, or phone number', async () => {
    await registerGuest({
      fullName: 'Maria Santos',
      contactNumber: '09189998888',
      email: 'maria@example.com',
      department: 'Finance',
      attendance: 'attending',
      mediaAgreement: true
    })

    await expect(
      registerGuest({
        fullName: '  maria   santos ',
        attendance: 'attending',
        mediaAgreement: true
      })
    ).rejects.toThrow(/already registered/i)

    await expect(
      registerGuest({
        fullName: 'Maria S.',
        email: 'MARIA@example.com',
        attendance: 'attending',
        mediaAgreement: true
      })
    ).rejects.toThrow(/email address is already registered/i)

    await expect(
      registerGuest({
        fullName: 'Maria Clara',
        contactNumber: '0918-999-8888',
        attendance: 'attending',
        mediaAgreement: true
      })
    ).rejects.toThrow(/contact number is already registered/i)
  })

  it('3. Allows a returning guest to recover their existing session without resetting shots', async () => {
    const { guest, session } = await registerGuest({
      fullName: 'Carlos Reyes',
      email: 'carlos@jmall.com',
      attendance: 'attending',
      mediaAgreement: true
    })

    await submitCapturedPhoto({
      sessionId: session.id,
      guestId: guest.id,
      processedBlob: createValidJpegBlob(),
      capturedAt: '2026-12-19T20:00:00.000Z',
      flashUsed: true,
      facingMode: 'environment',
      preset: 'kodak-gold',
      width: 1080,
      height: 1440
    })

    const recovered = await recoverGuestSession('Carlos Reyes', 'carlos@jmall.com')
    expect(recovered.guest.id).toBe(guest.id)
    expect(recovered.session.usedShots).toBe(1)
    expect(recovered.session.totalShots - recovered.session.usedShots).toBe(9)
  })

  it('4. Consumes all 10 shots sequentially, gives each photo its own document, and blocks an 11th shot', async () => {
    const { guest, session } = await registerGuest({
      fullName: 'John Doe',
      attendance: 'attending',
      mediaAgreement: true
    })

    const docIds = new Set<string>()

    for (let i = 1; i <= 10; i++) {
      const result = await submitCapturedPhoto({
        sessionId: session.id,
        guestId: guest.id,
        processedBlob: createValidJpegBlob(`shot-${i}`),
        originalBlob: new Blob([`hd-original-uncompressed-shot-${i}`], { type: 'image/jpeg' }),
        capturedAt: new Date(2026, 11, 19, 20, i).toISOString(),
        flashUsed: true,
        facingMode: 'environment',
        preset: 'kodak-gold',
        width: 1080,
        height: 1440
      })

      expect(result.photo.shotNumber).toBe(i)
      expect(result.photo.id).toBe(`${session.id}_shot_${i}`)
      docIds.add(result.photo.id)
      expect(result.photo.filename).toBe(`John_Doe_${String(i).padStart(3, '0')}.jpg`)
      expect(result.photo.compressedImage).toMatch(/^data:image\/jpeg;base64,/)
      expect(result.photo.imageFormat).toBe('image/jpeg')
      expect(result.photo.status).toBe('active')
      expect(result.updatedSession.usedShots).toBe(i)
      expect(result.updatedGuest.usedShots).toBe(i)
    }

    // Every photo has its own distinct document ID (10 separate documents)
    expect(docIds.size).toBe(10)

    // Verify 11th shot is rejected
    await expect(
      submitCapturedPhoto({
        sessionId: session.id,
        guestId: guest.id,
        processedBlob: createValidJpegBlob('shot-11'),
        capturedAt: new Date().toISOString(),
        flashUsed: false,
        facingMode: 'environment',
        preset: 'kodak-gold',
        width: 1080,
        height: 1440
      })
    ).rejects.toThrow(/All 10 shots/i)

    const finalSession = await fetchCameraSessionById(session.id)
    expect(finalSession?.usedShots).toBe(10)
  })

  it('5. Failed uploads NEVER consume a shot, keep HD original in IndexedDB as pending, and support retry', async () => {
    const { guest, session } = await registerGuest({
      fullName: 'Elena Cruz',
      attendance: 'attending',
      mediaAgreement: true
    })

    const spy = vi.spyOn(storageAdapterModule, 'getStorageProvider').mockReturnValue({
      name: 'firestore',
      isPubliclyAccessible: true,
      statusDescription: 'Mock Failing Storage',
      uploadPhoto: vi.fn().mockRejectedValue(new Error('Network timeout during photo upload'))
    })

    const hdBlob = new Blob(['elena-hd-original-pixels-100pct-quality'], { type: 'image/jpeg' })

    await expect(
      submitCapturedPhoto({
        sessionId: session.id,
        guestId: guest.id,
        processedBlob: createValidJpegBlob('elena-compressed'),
        originalBlob: hdBlob,
        capturedAt: '2026-12-19T20:10:00.000Z',
        flashUsed: true,
        facingMode: 'environment',
        preset: 'kodak-gold',
        width: 1440,
        height: 1920
      })
    ).rejects.toThrow(/Network timeout/i)

    // Shot was NOT consumed
    const unchangedSession = await fetchCameraSessionById(session.id)
    expect(unchangedSession?.usedShots).toBe(0)

    // HD Original WAS saved in IndexedDB with uploadStatus: "pending" for retry
    const pendingList = await getPendingUploads(guest.id, session.eventId)
    expect(pendingList.length).toBe(1)
    expect(pendingList[0]!.uploadStatus).toBe('pending')
    expect(pendingList[0]!.imageBlob.size).toBe(hdBlob.size)

    // Restore working storage provider and retry the failed upload
    spy.mockRestore()
    const retryResult = await retryPendingPhotoUpload(pendingList[0]!.photoId)
    expect(retryResult.photo.shotNumber).toBe(1)
    expect(retryResult.updatedSession.usedShots).toBe(1)

    // Local HD image is now marked as "uploaded" and STILL stored in IndexedDB
    const afterRetryPending = await getPendingUploads(guest.id, session.eventId)
    expect(afterRetryPending.length).toBe(0)

    const localRecordAfterUpload = await getOriginalPhoto(retryResult.photo.id)
    expect(localRecordAfterUpload).not.toBeNull()
    expect(localRecordAfterUpload?.uploadStatus).toBe('uploaded')
    expect(localRecordAfterUpload?.imageBlob.size).toBe(hdBlob.size)
  })

  it('6. Rejects concurrent uploads on the same camera session', async () => {
    const { guest, session } = await registerGuest({
      fullName: 'Marco Polo',
      attendance: 'attending',
      mediaAgreement: true
    })

    const p1 = submitCapturedPhoto({
      sessionId: session.id,
      guestId: guest.id,
      processedBlob: createValidJpegBlob('first'),
      capturedAt: new Date().toISOString(),
      flashUsed: true,
      facingMode: 'environment',
      preset: 'kodak-gold',
      width: 1080,
      height: 1440
    })

    const p2 = submitCapturedPhoto({
      sessionId: session.id,
      guestId: guest.id,
      processedBlob: createValidJpegBlob('concurrent-second'),
      capturedAt: new Date().toISOString(),
      flashUsed: true,
      facingMode: 'environment',
      preset: 'kodak-gold',
      width: 1080,
      height: 1440
    })

    await expect(p2).rejects.toThrow(/already developing and uploading/i)
    const res1 = await p1
    expect(res1.updatedSession.usedShots).toBe(1)
  })

  it('7. Enforces Event Settings (registrationOpen, cameraEnabled, photoSubmissionOpen)', async () => {
    const { guest, session } = await registerGuest({
      fullName: 'Sofia Lim',
      attendance: 'attending',
      mediaAgreement: true
    })

    await updateEventSettings(session.eventId, { photoSubmissionOpen: false })

    await expect(
      submitCapturedPhoto({
        sessionId: session.id,
        guestId: guest.id,
        processedBlob: createValidJpegBlob(),
        capturedAt: new Date().toISOString(),
        flashUsed: false,
        facingMode: 'user',
        preset: 'fuji-warm',
        width: 1080,
        height: 1440
      })
    ).rejects.toThrow(/closed by the organizer/i)

    await updateEventSettings(session.eventId, { registrationOpen: false })
    await expect(
      registerGuest({
        fullName: 'Late Guest',
        attendance: 'attending',
        mediaAgreement: true
      })
    ).rejects.toThrow(/registration is currently closed/i)
  })

  it('8. Formats filenames properly and exports bulk ZIP without duplicate originals by default', async () => {
    expect(formatGuestPhotoFilename('John Doe', 1)).toBe('John_Doe_001.jpg')
    expect(formatGuestPhotoFilename('John Doe', 2)).toBe('John_Doe_002.jpg')
    expect(formatGuestPhotoFilename('Maria Santos', 1)).toBe('Maria_Santos_001.jpg')
    expect(formatDisposableDateStamp('2026-12-19T21:05:00')).toContain("'26 12 19")

    const { guest, session } = await registerGuest({
      fullName: 'John Doe',
      attendance: 'attending',
      mediaAgreement: true
    })

    const { photo } = await submitCapturedPhoto({
      sessionId: session.id,
      guestId: guest.id,
      processedBlob: createValidJpegBlob('processed-frame'),
      originalBlob: createValidJpegBlob('clean-original-frame'),
      capturedAt: '2026-12-19T21:15:00.000Z',
      flashUsed: true,
      facingMode: 'environment',
      preset: 'kodak-gold',
      width: 1080,
      height: 1440
    })

    expect(buildExportFilename(photo, false, false)).toBe('John_Doe_001.jpg')

    const zipDefault = await generateEventPhotosZipBlob([photo], {
      organizeByGuestFolder: true,
      includeTimestampInFilename: false,
      includeOriginals: false
    })
    expect(zipDefault.filenames).toEqual(['John_Doe/John_Doe_001.jpg'])

    const zipWithOriginals = await generateEventPhotosZipBlob([photo], {
      organizeByGuestFolder: true,
      includeTimestampInFilename: false,
      includeOriginals: true
    })
    expect(zipWithOriginals.filenames).toEqual([
      'John_Doe/John_Doe_001.jpg',
      'John_Doe/originals/John_Doe_001_ORIGINAL.jpg'
    ])
  })

  it('9. Verifies Admin authentication, viewing all compressed photos, and photo moderation', async () => {
    await expect(signInAdmin('intruder@hacker.com', 'password123')).rejects.toThrow(
      /Access denied/i
    )

    const adminSession = await signInAdmin('organizer@xmasroll.local', 'xmas2026')
    expect(adminSession.isAdminVerified).toBe(true)

    const { guest, session } = await registerGuest({
      fullName: 'Maria Santos',
      attendance: 'attending',
      mediaAgreement: true
    })

    const { photo } = await submitCapturedPhoto({
      sessionId: session.id,
      guestId: guest.id,
      processedBlob: createValidJpegBlob(),
      capturedAt: new Date().toISOString(),
      flashUsed: false,
      facingMode: 'environment',
      preset: 'holiday-velvet',
      width: 1080,
      height: 1440
    })

    const moderated = await updatePhotoModerationStatus(photo.id, 'hidden')
    expect(moderated.status).toBe('hidden')

    const allGuests = await fetchAllGuestsForAdmin()
    const allPhotos = await fetchAllPhotosForAdmin()
    expect(allGuests.length).toBe(1)
    expect(allPhotos.length).toBe(1)
    expect(allPhotos[0]!.compressedImage).toMatch(/^data:image\/jpeg;base64,/)

    await signOutAdmin()
  })

  it('10. Verifies Image Processing: 75% JPEG quality, strict 3 height x 2 width (2:3) aspect ratio, and original preservation', async () => {
    // Strict 2 width : 3 height aspect ratio & center-crop calculations
    expect(calculateAspectRatioDimensions(2000, 3000, MAX_COMPRESSED_DIMENSION)).toEqual({
      width: 1280,
      height: 1920
    })
    expect(calculateAspectRatioDimensions(960, 1440, MAX_COMPRESSED_DIMENSION)).toEqual({
      width: 960,
      height: 1440
    })
    // Even if a non-2:3 source dimension is passed, output is strictly 2 width : 3 height (width * 3 === height * 2)
    const croppedFrom4x3 = computeCenterCrop3x2(1080, 1440)
    expect(croppedFrom4x3.outWidth * 3).toBe(croppedFrom4x3.outHeight * 2)
    expect(croppedFrom4x3.outWidth).toBe(960)
    expect(croppedFrom4x3.outHeight).toBe(1440)

    // Original HD Blob must NOT be mutated by compression
    const hdOriginalBytes = new Uint8Array(2048).fill(120)
    const hdOriginalBlob = new Blob([hdOriginalBytes], { type: 'image/png' })
    const originalSizeBefore = hdOriginalBlob.size

    const compressed = await compressBlobForFirestore(hdOriginalBlob, {
      sourceWidth: 1600,
      sourceHeight: 2400,
      quality: DEFAULT_COMPRESSED_JPEG_QUALITY
    })

    expect(hdOriginalBlob.size).toBe(originalSizeBefore)
    expect(compressed.qualityUsed).toBe(0.75)
    expect(compressed.imageFormat).toBe('image/jpeg')
    expect(compressed.width).toBe(1280)
    expect(compressed.height).toBe(1920)
    expect(compressed.width * 3).toBe(compressed.height * 2)
    expect(compressed.compressedBase64).toMatch(/^data:image\/jpeg;base64,/)
  })

  it('11. Enforces ~700 KiB Firestore document size limit, recompresses adaptively, and rejects excessive payloads without consuming a shot', async () => {
    const { guest, session } = await registerGuest({
      fullName: 'Paolo Gomez',
      attendance: 'attending',
      mediaAgreement: true
    })

    // 1. Adaptive recompression when raw buffer is ~600 KB (Base64 ~800 KB initially, steps down to fit < 700 KB)
    const mediumBuffer = new Uint8Array(600 * 1024).fill(65)
    const mediumBlob = new Blob([mediumBuffer], { type: 'image/png' })
    const adapted = await compressBlobForFirestore(mediumBlob, {
      allowAdaptiveRecompression: true
    })
    expect(adapted.estimatedDocBytes).toBeLessThanOrEqual(MAX_FIRESTORE_PAYLOAD_BYTES)
    expect(validateFirestoreDocumentSize(adapted.compressedBase64).valid).toBe(true)

    // 2. Uncompressible oversized payload (> 3 MB) fails cleanly and does NOT consume a shot
    const hugeBuffer = new Uint8Array(3 * 1024 * 1024).fill(90)
    const hugeBlob = new Blob([hugeBuffer], { type: 'image/jpeg' })

    await expect(
      submitCapturedPhoto({
        sessionId: session.id,
        guestId: guest.id,
        processedBlob: hugeBlob,
        originalBlob: hugeBlob,
        capturedAt: new Date().toISOString(),
        flashUsed: true,
        facingMode: 'environment',
        preset: 'kodak-gold',
        width: 1440,
        height: 1920
      })
    ).rejects.toThrow(/exceeds the safe Firestore document limit/i)

    const sessionAfterOversized = await fetchCameraSessionById(session.id)
    expect(sessionAfterOversized?.usedShots).toBe(0)
  })

  it('12. Verifies IndexedDB CRUD, Guest HD downloads (single + ZIP), missing HD message, and browser refresh reconciliation', async () => {
    const { guest, session } = await registerGuest({
      fullName: 'Bea Alonzo',
      attendance: 'attending',
      mediaAgreement: true
    })

    const hdOriginalContent = 'bea-full-hd-uncompressed-original-bytes-v1'
    const hdOriginalBlob = new Blob([hdOriginalContent], { type: 'image/jpeg' })

    const { photo } = await submitCapturedPhoto({
      sessionId: session.id,
      guestId: guest.id,
      processedBlob: createValidJpegBlob('bea-compressed-75pct'),
      originalBlob: hdOriginalBlob,
      capturedAt: '2026-12-19T22:00:00.000Z',
      flashUsed: true,
      facingMode: 'environment',
      preset: 'kodak-gold',
      width: 1440,
      height: 1920
    })

    // Verify localStorage does NOT contain any image binaries or Base64 data URLs
    const rawLocalStorageDb = localStorage.getItem('xmas_roll_database_v1') || ''
    expect(rawLocalStorageDb).not.toContain('data:image/jpeg;base64,')

    // 1. HD original remains in IndexedDB with status "uploaded" and exact uncompressed size
    const storedHd = await getOriginalPhoto(photo.id)
    expect(storedHd).not.toBeNull()
    expect(storedHd?.uploadStatus).toBe('uploaded')
    expect(storedHd?.imageBlob.size).toBe(hdOriginalBlob.size)

    const guestIdbList = await getGuestPhotos(guest.id, session.eventId)
    expect(guestIdbList.length).toBe(1)

    // 2. Guest can download single HD original from IndexedDB
    const singleHdDownload = await downloadOriginalPhotoFromIndexedDb(photo.id, photo.filename)
    expect(singleHdDownload.filename).toBe('Bea_Alonzo_001_HD.jpg')
    expect(singleHdDownload.sizeBytes).toBe(hdOriginalBlob.size)

    // 3. Guest can download all HD originals as a ZIP
    const hdZip = await generateGuestHdOriginalsZipBlob(guest.id, guest.fullName, session.eventId)
    expect(hdZip.exportedCount).toBe(1)
    expect(hdZip.filenames).toEqual(['Bea_Alonzo_001_HD.jpg'])

    // 4. Simulate browser refresh before Step 10 marked IndexedDB as "uploaded"
    await updateUploadStatus(photo.id, 'pending')
    const reconciled = await reconcileAndGetPendingUploads(guest.id, session.eventId)
    // Because photo.id already exists in Firestore, reconciliation marks it "uploaded" and returns 0 pending!
    expect(reconciled.length).toBe(0)
    const afterReconcile = await getOriginalPhoto(photo.id)
    expect(afterReconcile?.uploadStatus).toBe('uploaded')

    // 5. If HD original is missing locally (e.g. deleted or opened on another device), throws clear error
    await deleteOriginalPhoto(photo.id)
    await expect(downloadOriginalPhotoFromIndexedDb(photo.id, photo.filename)).rejects.toThrow(
      /not available on this device/i
    )

    // 6. Direct saveOriginalPhoto() stores and retrieves a record accurately
    const manualSaved = await saveOriginalPhoto({
      id: 'manual_hd_1',
      eventId: session.eventId,
      guestId: guest.id,
      photoId: 'manual_hd_1',
      imageBlob: hdOriginalBlob,
      capturedAt: '2026-12-19T22:05:00.000Z',
      uploadStatus: 'pending'
    })
    expect(manualSaved.uploadStatus).toBe('pending')
    const fetchedManual = await getOriginalPhoto('manual_hd_1')
    expect(fetchedManual?.imageBlob.size).toBe(hdOriginalBlob.size)

    // Meanwhile, compressed Firestore photo is still intact
    const firestorePhotos = await fetchGuestPhotos(guest.id, session.eventId)
    expect(firestorePhotos.length).toBe(1)
    expect(firestorePhotos[0]!.compressedImage).toMatch(/^data:image\/jpeg;base64,/)
  })

  it('13. Verifies Firebase jmall-xmas-roll Web App config and Google Sign-In helpers', async () => {
    expect(firebaseConfig.projectId).toBe('jmall-xmas-roll')
    expect(firebaseConfig.appId).toBe('1:672029754347:web:d4c3e77c6e32ec32f4cfae')
    expect(firebaseConfig.authDomain).toBe('jmall-xmas-roll.firebaseapp.com')
    expect(googleProvider.providerId).toBe('google.com')

    const googleAdmin = await signInAdminWithGoogle()
    expect(googleAdmin.isAdminVerified).toBe(true)
    expect(googleAdmin.authProvider).toBe('google')

    const googleGuest = await signInGuestWithGoogle()
    expect(googleGuest.email).toContain('@')
    expect(googleGuest.fullName.length).toBeGreaterThanOrEqual(2)

    await signOutAdmin()
  })
})
