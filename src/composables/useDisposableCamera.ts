import { onBeforeUnmount, ref, shallowRef } from 'vue'
import type { FilmEffectConfig } from '@/types'
import { processCameraFrame, type ProcessedFilmFrame } from '@/services/filmProcessor'

export type CameraPermissionStatus = 'idle' | 'requesting' | 'granted' | 'denied' | 'fallback'

export function useDisposableCamera() {
  const videoRef = ref<HTMLVideoElement | null>(null)
  const fallbackCanvasRef = ref<HTMLCanvasElement | null>(null)
  const activeStream = shallowRef<MediaStream | null>(null)

  const permissionStatus = ref<CameraPermissionStatus>('idle')
  const permissionError = ref<string>('')
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

  function stopCameraStream(): void {
    if (fallbackAnimId !== null) {
      cancelAnimationFrame(fallbackAnimId)
      fallbackAnimId = null
    }
    if (activeStream.value) {
      activeStream.value.getTracks().forEach((track) => track.stop())
      activeStream.value = null
    }
    if (videoRef.value) {
      videoRef.value.srcObject = null
    }
  }

  /**
   * Renders an animated holiday scene on the fallback canvas when a device has no physical camera
   * or when the user chooses to test the camera in simulated viewfinder mode.
   */
  function startSimulatedViewfinder(): void {
    permissionStatus.value = 'fallback'
    const renderLoop = (time: number) => {
      const canvas = fallbackCanvasRef.value
      if (canvas) {
        const ctx = canvas.getContext('2d')
        if (ctx) {
          const w = canvas.width || 640
          const h = canvas.height || 960
          // Warm holiday bokeh background
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

          // Animated warm fairy light bokeh circles
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

          // Festive centerpiece silhouette (Christmas Tree & Cheers Toast)
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
          // Star on top
          ctx.fillStyle = '#F2C97D'
          ctx.beginPath()
          ctx.arc(0, -146, 14 + Math.sin(time * 0.005) * 2, 0, Math.PI * 2)
          ctx.fill()

          // Party banner caption inside scene
          ctx.fillStyle = 'rgba(245, 240, 230, 0.9)'
          ctx.font = '700 24px "Fraunces", Georgia, serif'
          ctx.textAlign = 'center'
          ctx.fillText('JMALL CHRISTMAS PARTY', 0, 170)
          ctx.font = '400 15px "Space Mono", monospace'
          ctx.fillStyle = 'rgba(199, 166, 106, 0.9)'
          ctx.fillText(
            facingMode.value === 'environment' ? 'REAR LENS · 35MM 3x2' : 'SELFIE LENS · 35MM 3x2',
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

  async function startCamera(requestedFacing = facingMode.value): Promise<boolean> {
    stopCameraStream()
    permissionError.value = ''
    permissionStatus.value = 'requesting'
    facingMode.value = requestedFacing

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

    try {
      const constraints: MediaStreamConstraints = {
        audio: false,
        video: {
          facingMode: { ideal: requestedFacing },
          width: { ideal: 1280 },
          height: { ideal: 1920 },
          aspectRatio: { ideal: 2 / 3 }
        }
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      activeStream.value = stream
      permissionStatus.value = 'granted'

      if (videoRef.value) {
        videoRef.value.srcObject = stream
        await videoRef.value.play().catch(() => {
          // Autoplay handled by muted + playsinline attributes
        })
      }
      return true
    } catch (err: any) {
      const errName = err?.name || ''
      if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
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
  }

  async function switchCameraFacing(): Promise<void> {
    if (isSwitchingCamera.value) return
    isSwitchingCamera.value = true
    try {
      const nextFacing = facingMode.value === 'environment' ? 'user' : 'environment'
      facingMode.value = nextFacing
      if (permissionStatus.value === 'granted') {
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
    if (!flashEnabled.value || !activeStream.value) return
    const track = activeStream.value.getVideoTracks()[0]
    if (!track || typeof track.getCapabilities !== 'function') return
    try {
      const caps = track.getCapabilities() as Record<string, any>
      if (caps.torch) {
        await track.applyConstraints({ advanced: [{ torch: true } as any] })
        setTimeout(() => {
          track.applyConstraints({ advanced: [{ torch: false } as any] }).catch(() => {})
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

      if (permissionStatus.value === 'granted' && videoRef.value) {
        const video = videoRef.value
        const w = video.videoWidth || 960
        const h = video.videoHeight || 1440
        const mirror = facingMode.value === 'user'

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
          false,
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

