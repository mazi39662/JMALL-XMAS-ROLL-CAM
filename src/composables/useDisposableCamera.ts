import { nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import type { FilmEffectConfig } from '../types'
import { processCameraFrame, type ProcessedFilmFrame } from '../services/filmProcessor'

export type CameraPermissionStatus = 'idle' | 'requesting' | 'granted' | 'denied' | 'fallback'

export function useDisposableCamera() {
  const videoRef = ref<HTMLVideoElement | null>(null)
  const fallbackCanvasRef = ref<HTMLCanvasElement | null>(null)
  const activeStream = shallowRef<MediaStream | null>(null)

  const permissionStatus = ref<CameraPermissionStatus>('idle')
  const permissionError = ref<string>('')
  // Default to back camera ('environment') with option to switch to front camera ('user')
  const facingMode = ref<'environment' | 'user'>('environment')
  const flashEnabled = ref<boolean>(true)
  const isShutterFiring = ref<boolean>(false)
  const isFlashBursting = ref<boolean>(false)
  const isSwitchingCamera = ref<boolean>(false)

  const filmConfig = ref<FilmEffectConfig>({
    grainIntensity: 0.24,
    warmthPreset: 'kodak-gold',
    overlayPreset: '35mm-film',
    flashActive: true,
    vignetteIntensity: 0.38,
    dateStamp: true,
    filmFrameOverlay: true
  })

  let fallbackAnimId: number | null = null
  let activeDeviceId: string | null = null

  function stopCameraStream(): void {
    if (fallbackAnimId !== null) {
      cancelAnimationFrame(fallbackAnimId)
      fallbackAnimId = null
    }
    if (activeStream.value) {
      activeStream.value.getTracks().forEach((track) => {
        try {
          track.stop()
        } catch {
          // Ignore track stop errors
        }
      })
      activeStream.value = null
    }
    if (videoRef.value) {
      videoRef.value.srcObject = null
    }
  }

  async function attachStreamToVideoElement(stream: MediaStream): Promise<void> {
    await nextTick()
    const videoEl = videoRef.value
    if (!videoEl) return

    if (videoEl.srcObject !== stream) {
      videoEl.srcObject = stream
    }

    try {
      await videoEl.play()
    } catch {
      // Wait for loadedmetadata if direct play() was deferred by the browser
      await new Promise<void>((resolve) => {
        const onLoaded = () => {
          videoEl.removeEventListener('loadedmetadata', onLoaded)
          videoEl.play().catch(() => {})
          resolve()
        }
        videoEl.addEventListener('loadedmetadata', onLoaded, { once: true })
        setTimeout(resolve, 400)
      })
    }
  }

  watch(videoRef, (newVideoEl) => {
    if (newVideoEl && activeStream.value) {
      attachStreamToVideoElement(activeStream.value)
    }
  })

  /**
   * Renders an animated holiday scene on the fallback canvas when a device has no physical camera
   * or when the user chooses to test the camera in simulated viewfinder mode.
   */
  function startSimulatedViewfinder(): void {
    if (fallbackAnimId !== null) {
      cancelAnimationFrame(fallbackAnimId)
      fallbackAnimId = null
    }
    permissionStatus.value = 'fallback'
    const renderLoop = (time: number) => {
      const canvas = fallbackCanvasRef.value
      if (canvas) {
        const ctx = canvas.getContext('2d')
        if (ctx) {
          const w = canvas.width || 640
          const h = canvas.height || 960
          const grad = ctx.createLinearGradient(0, 0, w, h)
          if (facingMode.value === 'environment') {
            grad.addColorStop(0, '#132E25')
            grad.addColorStop(0.5, '#2A1D1B')
            grad.addColorStop(1, '#3D231E')
          } else {
            grad.addColorStop(0, '#2B1F2A')
            grad.addColorStop(0.5, '#183D32')
            grad.addColorStop(1, '#2D2419')
          }
          ctx.fillStyle = grad
          ctx.fillRect(0, 0, w, h)

          const bokehSeeds = [
            { x: 0.2, y: 0.22, r: 46, c: 'rgba(255, 200, 110, 0.32)', s: 0.0012 },
            { x: 0.78, y: 0.18, r: 58, c: 'rgba(215, 75, 65, 0.28)', s: 0.0015 },
            { x: 0.52, y: 0.34, r: 38, c: 'rgba(255, 225, 150, 0.36)', s: 0.001 },
            { x: 0.18, y: 0.65, r: 64, c: 'rgba(199, 166, 106, 0.25)', s: 0.0009 },
            { x: 0.84, y: 0.62, r: 52, c: 'rgba(255, 180, 90, 0.3)', s: 0.0013 },
            { x: 0.45, y: 0.75, r: 42, c: 'rgba(65, 155, 115, 0.26)', s: 0.0011 }
          ]

          for (const b of bokehSeeds) {
            const offsetX = Math.sin(time * b.s) * 18
            const offsetY = Math.cos(time * b.s * 1.2) * 14
            ctx.beginPath()
            ctx.arc(w * b.x + offsetX, h * b.y + offsetY, b.r, 0, Math.PI * 2)
            ctx.fillStyle = b.c
            ctx.fill()
          }

          ctx.save()
          ctx.translate(w * 0.5, h * 0.52)
          ctx.fillStyle = '#1E4B3C'
          for (let tier = 0; tier < 3; tier++) {
            const topY = -140 + tier * 58
            const halfW = 75 + tier * 38
            ctx.beginPath()
            ctx.moveTo(0, topY)
            ctx.lineTo(-halfW, topY + 95)
            ctx.lineTo(halfW, topY + 95)
            ctx.closePath()
            ctx.fill()
          }
          ctx.fillStyle = '#F2C97D'
          ctx.beginPath()
          ctx.arc(0, -146, 14 + Math.sin(time * 0.005) * 2, 0, Math.PI * 2)
          ctx.fill()

          ctx.fillStyle = 'rgba(245, 240, 230, 0.9)'
          ctx.font = '700 24px "Fraunces", Georgia, serif'
          ctx.textAlign = 'center'
          ctx.fillText('JMALL CHRISTMAS PARTY', 0, 170)
          ctx.font = '400 15px "Space Mono", monospace'
          ctx.fillStyle = 'rgba(199, 166, 106, 0.9)'
          ctx.fillText(
            facingMode.value === 'environment' ? 'BACK CAMERA · 35MM' : 'FRONT CAMERA · 35MM',
            0,
            200
          )
          ctx.restore()
        }
      }
      fallbackAnimId = requestAnimationFrame(renderLoop)
    }
    fallbackAnimId = requestAnimationFrame(renderLoop)
  }

  /**
   * Attempts to find a matching back ('environment') or front ('user') video input deviceId
   * when multiple cameras exist on the device.
   */
  async function findMatchingCameraDeviceId(
    targetFacing: 'environment' | 'user',
    previousDeviceId: string | null
  ): Promise<string | null> {
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.enumerateDevices !== 'function'
    ) {
      return null
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const videoInputs = devices.filter((d) => d.kind === 'videoinput' && d.deviceId)
      if (videoInputs.length < 2) return null

      const frontPattern = /front|user|selfie|facetime|integrated/i
      const backPattern = /back|rear|environment|world|main|wide/i
      const teleOrMacroPattern = /tele|zoom|macro|depth/i
      const targetPattern = targetFacing === 'user' ? frontPattern : backPattern

      // Prefer main 1x wide lens (avoid telephoto/zoom/macro lenses)
      const matchedByLabel =
        videoInputs.find(
          (d) => targetPattern.test(d.label) && !teleOrMacroPattern.test(d.label)
        ) || videoInputs.find((d) => targetPattern.test(d.label))
      if (matchedByLabel) {
        return matchedByLabel.deviceId
      }

      if (previousDeviceId) {
        const alternate = videoInputs.find((d) => d.deviceId !== previousDeviceId)
        if (alternate) return alternate.deviceId
      }
      return null
    } catch {
      return null
    }
  }

  /**
   * Ensures the active video track is at 1x (unzoomed) native field of view
   * and disables browser crop/resize where supported.
   */
  async function resetTrackZoomToDefault(track: MediaStreamTrack | undefined): Promise<void> {
    if (!track || typeof track.getCapabilities !== 'function') return
    try {
      const caps = track.getCapabilities() as Record<string, unknown>
      const zoomCap = caps.zoom as { min?: number; max?: number } | undefined
      if (zoomCap && typeof zoomCap.min === 'number' && typeof zoomCap.max === 'number') {
        // Default to 1.0x (standard wide unzoomed lens) clamped to [min, max]
        const targetZoom = Math.min(Math.max(1, zoomCap.min), zoomCap.max)
        await track.applyConstraints({
          advanced: [{ zoom: targetZoom } as unknown as MediaTrackConstraintSet]
        })
      }
    } catch {
      // Zoom constraint not supported on this device/browser
    }
  }

  async function startCamera(
    requestedFacing: 'environment' | 'user' = 'environment'
  ): Promise<boolean> {
    const hadActiveStream = Boolean(activeStream.value)
    const previousDeviceId = activeDeviceId
    stopCameraStream()
    permissionError.value = ''
    facingMode.value = requestedFacing

    if (!hadActiveStream) {
      permissionStatus.value = 'requesting'
    }

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      permissionError.value =
        'Camera API unavailable in this browser context. Using interactive 35mm studio viewfinder.'
      startSimulatedViewfinder()
      return false
    }

    // Brief pause when switching active cameras so mobile camera HAL releases the previous lens cleanly
    if (hadActiveStream) {
      await new Promise((resolve) => setTimeout(resolve, 60))
    }

    // Progressive constraint candidates:
    // Do NOT force landscape width/height here — letting the camera use its native uncropped
    // sensor dimensions prevents mobile browsers from double-cropping (zooming in) the video feed.
    const constraintCandidates: MediaStreamConstraints[] = [
      {
        audio: false,
        video: {
          facingMode: { exact: requestedFacing }
        }
      },
      {
        audio: false,
        video: {
          facingMode: { ideal: requestedFacing }
        }
      },
      {
        audio: false,
        video: {
          facingMode: requestedFacing
        }
      },
      {
        audio: false,
        video: true
      }
    ]

    let lastError: unknown = null

    for (const candidate of constraintCandidates) {
      try {
        let stream = await navigator.mediaDevices.getUserMedia(candidate)
        const track = stream.getVideoTracks()[0]
        const currentDeviceId = track?.getSettings?.()?.deviceId

        // If we are switching cameras on a multi-camera device and the browser returned the same deviceId,
        // try selecting the matching front/back deviceId explicitly
        if (
          hadActiveStream &&
          previousDeviceId &&
          currentDeviceId &&
          currentDeviceId === previousDeviceId
        ) {
          const explicitDeviceId = await findMatchingCameraDeviceId(
            requestedFacing,
            previousDeviceId
          )
          if (explicitDeviceId && explicitDeviceId !== currentDeviceId) {
            try {
              stream.getTracks().forEach((t) => t.stop())
              stream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: {
                  deviceId: { exact: explicitDeviceId }
                }
              })
            } catch {
              // Re-acquire stream if explicit deviceId attempt failed
              stream = await navigator.mediaDevices.getUserMedia(candidate)
            }
          }
        }

        const activeTrack = stream.getVideoTracks()[0]
        await resetTrackZoomToDefault(activeTrack)
        activeDeviceId = activeTrack?.getSettings?.()?.deviceId || null
        activeStream.value = stream
        permissionStatus.value = 'granted'
        await attachStreamToVideoElement(stream)
        return true
      } catch (err: unknown) {
        lastError = err
        const errName = (err as { name?: string })?.name || ''
        // If user explicitly denied camera permission, stop immediately and show permission prompt
        if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
          permissionStatus.value = 'denied'
          permissionError.value =
            'Camera permission was denied. Please allow camera access in your browser address bar, or use the simulated 35mm viewfinder below.'
          return false
        }
        // Otherwise continue trying the next fallback constraint candidate
      }
    }

    const finalErrName = (lastError as { name?: string })?.name || ''
    if (finalErrName === 'NotAllowedError' || finalErrName === 'PermissionDeniedError') {
      permissionStatus.value = 'denied'
      permissionError.value =
        'Camera permission was denied. Please allow camera access in your browser address bar, or use the simulated 35mm viewfinder below.'
    } else {
      permissionError.value =
        'No physical camera detected on this device. Active in simulated 35mm holiday viewfinder mode.'
      startSimulatedViewfinder()
    }
    return false
  }

  /**
   * Toggles between Back Camera ('environment') and Front Camera ('user')
   */
  async function switchCameraFacing(): Promise<void> {
    if (isSwitchingCamera.value) return
    isSwitchingCamera.value = true
    try {
      const nextFacing: 'environment' | 'user' =
        facingMode.value === 'environment' ? 'user' : 'environment'
      facingMode.value = nextFacing

      if (permissionStatus.value !== 'fallback') {
        await startCamera(nextFacing)
      }
    } finally {
      isSwitchingCamera.value = false
    }
  }

  function toggleFlash(): void {
    flashEnabled.value = !flashEnabled.value
    filmConfig.value.flashActive = flashEnabled.value
  }

  /**
   * Attempts hardware torch flash on supported mobile rear cameras during shutter release
   */
  async function pulseHardwareTorchIfAvailable(durationMs = 260): Promise<void> {
    if (!flashEnabled.value || !activeStream.value || facingMode.value !== 'environment') return
    const track = activeStream.value.getVideoTracks()[0]
    if (!track || typeof track.getCapabilities !== 'function') return
    try {
      const caps = track.getCapabilities() as Record<string, unknown>
      if (caps.torch) {
        await track.applyConstraints({
          advanced: [{ torch: true } as unknown as MediaTrackConstraintSet]
        })
        setTimeout(() => {
          track
            .applyConstraints({
              advanced: [{ torch: false } as unknown as MediaTrackConstraintSet]
            })
            .catch(() => {})
        }, durationMs)
      }
    } catch {
      // Torch not supported on this device/browser; screen flash + canvas flash handles it
    }
  }

  /**
   * Captures the live video frame (or fallback studio frame), triggers the shutter & flash animations,
   * and returns the processed 35mm disposable film frame + clean original.
   */
  async function captureFrame(nextShotNumber: number): Promise<ProcessedFilmFrame> {
    if (isShutterFiring.value) {
      throw new Error('Shutter is currently cycling.')
    }

    isShutterFiring.value = true
    if (flashEnabled.value) {
      isFlashBursting.value = true
      pulseHardwareTorchIfAvailable(280)
      setTimeout(() => {
        isFlashBursting.value = false
      }, 320)
    }

    try {
      filmConfig.value.flashActive = flashEnabled.value
      const capturedAt = new Date().toISOString()
      const mirror = facingMode.value === 'user'

      if (permissionStatus.value === 'granted' && videoRef.value) {
        const video = videoRef.value

        // Ensure video frame has decoded dimensions before capturing
        if (video.videoWidth === 0 || video.videoHeight === 0) {
          await new Promise((resolve) => setTimeout(resolve, 120))
        }

        const w = video.videoWidth || 960
        const h = video.videoHeight || 1440

        return await processCameraFrame(
          video,
          w,
          h,
          mirror,
          filmConfig.value,
          nextShotNumber,
          capturedAt
        )
      }

      if (fallbackCanvasRef.value) {
        const canvas = fallbackCanvasRef.value
        return await processCameraFrame(
          canvas,
          canvas.width || 640,
          canvas.height || 960,
          mirror,
          filmConfig.value,
          nextShotNumber,
          capturedAt
        )
      }

      throw new Error('Camera viewfinder is not ready yet.')
    } finally {
      setTimeout(() => {
        isShutterFiring.value = false
      }, 260)
    }
  }

  onBeforeUnmount(() => {
    stopCameraStream()
  })

  return {
    videoRef,
    fallbackCanvasRef,
    permissionStatus,
    permissionError,
    facingMode,
    flashEnabled,
    isShutterFiring,
    isFlashBursting,
    isSwitchingCamera,
    filmConfig,
    startCamera,
    stopCameraStream,
    startSimulatedViewfinder,
    switchCameraFacing,
    toggleFlash,
    captureFrame
  }
}
