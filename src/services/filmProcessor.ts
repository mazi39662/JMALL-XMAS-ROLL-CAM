import type { FilmEffectConfig, FilmFilterPreset, FilmOverlayPreset } from '@/types'
import {
  compressCanvasForFirestore,
  DEFAULT_COMPRESSED_JPEG_QUALITY,
  MAX_COMPRESSED_DIMENSION
} from './imageProcessor'

export interface ProcessedFilmFrame {
  processedBlob: Blob
  compressedBase64: string
  originalBlob: Blob
  rawOriginalBlob?: Blob
  previewDataUrl: string
  originalPreviewDataUrl: string
  width: number
  height: number
  originalWidth: number
  originalHeight: number
  sourceCanvas?: HTMLCanvasElement
  effectsCanvas?: HTMLCanvasElement
}

export const FILM_FILTER_OPTIONS: Array<{
  id: FilmFilterPreset
  label: string
  shortTag: string
}> = [
  { id: 'kodak-gold', label: 'Kodak Gold', shortTag: 'GOLD 200' },
  { id: 'fuji-warm', label: 'Fuji Warm', shortTag: 'SUPERIA 400' },
  { id: 'holiday-velvet', label: 'Xmas Glow', shortTag: 'XMAS VELVET' },
  { id: 'polaroid-fade', label: '90s Instant', shortTag: 'INSTANT 90S' },
  { id: 'retro-bw', label: 'B&W Film', shortTag: 'ILFORD 400' },
  { id: 'cyber-xmas', label: 'Night Neon', shortTag: 'ROOFTOP 800' }
]

export const FILM_OVERLAY_OPTIONS: Array<{
  id: FilmOverlayPreset
  label: string
}> = [
  { id: '35mm-film', label: '35mm Strip' },
  { id: 'polaroid', label: 'Polaroid' },
  { id: 'light-leak', label: 'Light Leak' },
  { id: 'xmas-stamp', label: 'Xmas Frame' },
  { id: 'none', label: 'No Frame' }
]

function clampByte(val: number): number {
  return val < 0 ? 0 : val > 255 ? 255 : val | 0
}

/**
 * Formats an ISO date string into an authentic 90s disposable camera quartz date stamp
 * e.g. '26 12 19  20:45
 */
export function formatDisposableDateStamp(isoDate: string): string {
  const d = new Date(isoDate)
  const yy = String(d.getFullYear()).slice(-2)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `'${yy} ${mm} ${dd}  ${hh}:${min}`
}

/**
 * Converts a canvas element to a JPEG Blob reliably
 */
export function canvasToJpegBlob(canvas: HTMLCanvasElement, quality = 0.88): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob === 'function') {
      try {
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob)
            } else {
              resolve(new Blob(['fallback-jpeg-bytes'], { type: 'image/jpeg' }))
            }
          },
          'image/jpeg',
          quality
        )
        return
      } catch {
        // Fallback below
      }
    }
    try {
      const dataUrl = canvas.toDataURL('image/jpeg', quality)
      const parts = dataUrl.split(',')
      if (parts.length === 2 && parts[1]) {
        const byteString = atob(parts[1])
        const ab = new ArrayBuffer(byteString.length)
        const ia = new Uint8Array(ab)
        for (let i = 0; i < byteString.length; i++) {
          ia[i] = byteString.charCodeAt(i)
        }
        resolve(new Blob([ab], { type: 'image/jpeg' }))
      } else {
        resolve(new Blob(['fallback-jpeg'], { type: 'image/jpeg' }))
      }
    } catch (err) {
      reject(err)
    }
  })
}

/**
 * Draws the selected camera frame overlay onto the 2D Canvas context
 */
function drawOverlayPreset(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  overlay: FilmOverlayPreset,
  shotNumber: number
): void {
  if (overlay === 'none') return

  const minDim = Math.min(width, height)

  if (overlay === '35mm-film') {
    ctx.save()
    const border = Math.max(18, Math.round(minDim * 0.036))

    // Dark 35mm film rebate border
    ctx.fillStyle = '#141311'
    ctx.fillRect(0, 0, width, border)
    ctx.fillRect(0, height - border, width, border)
    ctx.fillRect(0, 0, border * 0.75, height)
    ctx.fillRect(width - border * 0.75, 0, border * 0.75, height)

    ctx.strokeStyle = 'rgba(199, 166, 106, 0.32)'
    ctx.lineWidth = 1.5
    ctx.strokeRect(border * 0.75, border, width - border * 1.5, height - border * 2)

    const edgeFontSize = Math.max(9, Math.round(border * 0.48))
    ctx.font = `700 ${edgeFontSize}px "Space Mono", monospace`
    ctx.fillStyle = 'rgba(218, 168, 88, 0.82)'
    ctx.textBaseline = 'middle'

    ctx.fillText('KODAK / XMAS ROLL', border * 1.1, border * 0.52)
    ctx.fillText(`▶ ${shotNumber}A`, width * 0.5 - 20, border * 0.52)
    ctx.fillText('JMALL 2026', width - border * 4.5, border * 0.52)

    ctx.fillText(`◀ ${shotNumber}`, border * 1.1, height - border * 0.48)
    ctx.fillText('ROOFTOP PARTY', width * 0.43, height - border * 0.48)
    ctx.restore()
    return
  }

  if (overlay === 'polaroid') {
    ctx.save()
    const sideBorder = Math.max(20, Math.round(minDim * 0.048))
    const topBorder = Math.max(20, Math.round(minDim * 0.048))
    const bottomBorder = Math.max(68, Math.round(height * 0.135))

    // Warm cream Polaroid paper border
    ctx.fillStyle = '#F7F3EA'
    ctx.fillRect(0, 0, width, topBorder)
    ctx.fillRect(0, height - bottomBorder, width, bottomBorder)
    ctx.fillRect(0, 0, sideBorder, height)
    ctx.fillRect(width - sideBorder, 0, sideBorder, height)

    // Subtle inner photo shadow line
    ctx.strokeStyle = 'rgba(37, 37, 37, 0.18)'
    ctx.lineWidth = 2
    ctx.strokeRect(
      sideBorder,
      topBorder,
      width - sideBorder * 2,
      height - topBorder - bottomBorder
    )

    // Handwritten-style vintage caption on Polaroid bottom margin
    const titleSize = Math.max(16, Math.round(minDim * 0.036))
    const subSize = Math.max(11, Math.round(minDim * 0.02))
    ctx.fillStyle = '#183D32'
    ctx.font = `700 italic ${titleSize}px "Fraunces", Georgia, serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(
      'JMall Christmas Party ’26',
      width * 0.5,
      height - bottomBorder * 0.58
    )

    ctx.fillStyle = '#8F2B26'
    ctx.font = `700 ${subSize}px "Space Mono", monospace`
    ctx.fillText(
      `SHOT #${String(shotNumber).padStart(2, '0')} · PARKING LOT ROOFTOP`,
      width * 0.5,
      height - bottomBorder * 0.26
    )
    ctx.restore()
    return
  }

  if (overlay === 'light-leak') {
    ctx.save()
    // Authentic warm orange/crimson analog film light burn on left & top-right edges
    const leakLeft = ctx.createLinearGradient(0, 0, width * 0.42, height * 0.3)
    leakLeft.addColorStop(0, 'rgba(255, 72, 18, 0.58)')
    leakLeft.addColorStop(0.45, 'rgba(255, 158, 44, 0.28)')
    leakLeft.addColorStop(1, 'rgba(255, 180, 60, 0)')
    ctx.fillStyle = leakLeft
    ctx.fillRect(0, 0, width, height)

    const leakRight = ctx.createRadialGradient(
      width * 0.92,
      height * 0.18,
      10,
      width * 0.88,
      height * 0.22,
      minDim * 0.55
    )
    leakRight.addColorStop(0, 'rgba(255, 210, 120, 0.52)')
    leakRight.addColorStop(0.5, 'rgba(220, 55, 45, 0.26)')
    leakRight.addColorStop(1, 'rgba(220, 55, 45, 0)')
    ctx.fillStyle = leakRight
    ctx.fillRect(0, 0, width, height)

    // Thin dark film edge
    const thin = Math.max(10, Math.round(minDim * 0.018))
    ctx.strokeStyle = '#141311'
    ctx.lineWidth = thin * 2
    ctx.strokeRect(0, 0, width, height)
    ctx.restore()
    return
  }

  if (overlay === 'xmas-stamp') {
    ctx.save()
    const borderW = Math.max(18, Math.round(minDim * 0.036))

    // 1. Candy-Cane Diagonal Striped Outer Border (Red, Cream, Forest Green)
    const stripeCanvas = document.createElement('canvas')
    stripeCanvas.width = 48
    stripeCanvas.height = 48
    const sCtx = stripeCanvas.getContext('2d')
    if (sCtx) {
      sCtx.fillStyle = '#F7F2E7'
      sCtx.fillRect(0, 0, 48, 48)
      sCtx.strokeStyle = '#B53B35'
      sCtx.lineWidth = 10
      for (let i = -48; i <= 96; i += 24) {
        sCtx.beginPath()
        sCtx.moveTo(i, 0)
        sCtx.lineTo(i + 48, 48)
        sCtx.stroke()
      }
      sCtx.strokeStyle = '#183D32'
      sCtx.lineWidth = 5
      for (let i = -36; i <= 96; i += 24) {
        sCtx.beginPath()
        sCtx.moveTo(i, 0)
        sCtx.lineTo(i + 48, 48)
        sCtx.stroke()
      }
    }

    const pattern = sCtx ? ctx.createPattern(stripeCanvas, 'repeat') : null
    ctx.fillStyle = pattern || '#B53B35'
    ctx.fillRect(0, 0, width, borderW)
    ctx.fillRect(0, height - borderW, width, borderW)
    ctx.fillRect(0, 0, borderW, height)
    ctx.fillRect(width - borderW, 0, borderW, height)

    // Gold Inner Frame Trim
    ctx.strokeStyle = '#DFC492'
    ctx.lineWidth = 3
    ctx.strokeRect(borderW, borderW, width - borderW * 2, height - borderW * 2)

    // Helper: 4-point Star Sparkle
    const drawSparkle = (cx: number, cy: number, r: number, color = '#FFE082') => {
      ctx.save()
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.moveTo(cx, cy - r)
      ctx.quadraticCurveTo(cx, cy, cx + r, cy)
      ctx.quadraticCurveTo(cx, cy, cx, cy + r)
      ctx.quadraticCurveTo(cx, cy, cx - r, cy)
      ctx.quadraticCurveTo(cx, cy, cx, cy - r)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }

    // Helper: 6-branch Crystal Snowflake
    const drawSnowflake = (cx: number, cy: number, r: number) => {
      ctx.save()
      ctx.translate(cx, cy)
      ctx.strokeStyle = 'rgba(255, 252, 245, 0.88)'
      ctx.lineWidth = Math.max(1.5, r * 0.14)
      ctx.lineCap = 'round'
      for (let i = 0; i < 6; i++) {
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.lineTo(0, -r)
        ctx.moveTo(0, -r * 0.58)
        ctx.lineTo(-r * 0.26, -r * 0.78)
        ctx.moveTo(0, -r * 0.58)
        ctx.lineTo(r * 0.26, -r * 0.78)
        ctx.stroke()
        ctx.rotate(Math.PI / 3)
      }
      ctx.restore()
    }

    // 2. Top Lush Evergreen Garland Swags + Fairy String Lights
    const swags = 5
    const innerW = width - borderW * 2
    const swagW = innerW / swags
    ctx.save()
    for (let i = 0; i < swags; i++) {
      const startX = borderW + i * swagW
      const midX = startX + swagW * 0.5
      const endX = startX + swagW
      const droopY = borderW + minDim * 0.055

      ctx.fillStyle = '#14362B'
      ctx.beginPath()
      ctx.moveTo(startX, borderW)
      ctx.quadraticCurveTo(midX, droopY + minDim * 0.02, endX, borderW)
      ctx.closePath()
      ctx.fill()

      ctx.strokeStyle = '#245849'
      ctx.lineWidth = Math.max(5, minDim * 0.012)
      ctx.beginPath()
      ctx.moveTo(startX, borderW + 2)
      ctx.quadraticCurveTo(midX, droopY, endX, borderW + 2)
      ctx.stroke()

      // Gold Tinsel Cord + Glowing Fairy Light Bulbs
      ctx.strokeStyle = '#DFC492'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(startX, borderW + 3)
      ctx.quadraticCurveTo(midX, droopY + minDim * 0.012, endX, borderW + 3)
      ctx.stroke()

      const bulbColors = ['#FF5252', '#FFD740', '#69F0AE']
      const bulbColor = bulbColors[i % bulbColors.length]!
      ctx.save()
      ctx.shadowColor = bulbColor
      ctx.shadowBlur = 10
      ctx.fillStyle = bulbColor
      ctx.beginPath()
      ctx.arc(midX, droopY - minDim * 0.012, Math.max(4, minDim * 0.009), 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
    ctx.restore()

    // Helper: Hanging Bauble Ornament
    const drawHangingBauble = (
      x: number,
      topY: number,
      dropLen: number,
      radius: number,
      color: string
    ) => {
      ctx.save()
      ctx.strokeStyle = '#DFC492'
      ctx.lineWidth = 1.8
      ctx.beginPath()
      ctx.moveTo(x, topY)
      ctx.lineTo(x, topY + dropLen)
      ctx.stroke()

      const cy = topY + dropLen + radius
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(x, cy, radius, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#DFC492'
      ctx.lineWidth = 1.8
      ctx.stroke()

      ctx.strokeStyle = 'rgba(255, 224, 130, 0.75)'
      ctx.lineWidth = Math.max(2, radius * 0.22)
      ctx.beginPath()
      ctx.moveTo(x - radius * 0.9, cy)
      ctx.lineTo(x + radius * 0.9, cy)
      ctx.stroke()

      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'
      ctx.beginPath()
      ctx.arc(x - radius * 0.3, cy - radius * 0.3, radius * 0.24, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    // Helper: Twin Golden Christmas Bells with Red Bow & Holly
    const drawGoldenBells = (cx: number, cy: number, size: number) => {
      ctx.save()
      ctx.translate(cx, cy)

      const drawSingleBell = (angle: number, offsetX: number) => {
        ctx.save()
        ctx.translate(offsetX, 0)
        ctx.rotate(angle)
        ctx.fillStyle = '#EBBF65'
        ctx.strokeStyle = '#8C621E'
        ctx.lineWidth = 1.6
        ctx.beginPath()
        ctx.moveTo(0, -size * 0.45)
        ctx.bezierCurveTo(
          -size * 0.42,
          -size * 0.4,
          -size * 0.48,
          size * 0.25,
          -size * 0.58,
          size * 0.42
        )
        ctx.lineTo(size * 0.58, size * 0.42)
        ctx.bezierCurveTo(
          size * 0.48,
          size * 0.25,
          size * 0.42,
          -size * 0.4,
          0,
          -size * 0.45
        )
        ctx.closePath()
        ctx.fill()
        ctx.stroke()

        ctx.fillStyle = '#B88428'
        ctx.beginPath()
        ctx.arc(0, size * 0.46, size * 0.13, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }

      drawSingleBell(0.32, -size * 0.26)
      drawSingleBell(-0.32, size * 0.26)

      ctx.fillStyle = '#1D523F'
      ctx.beginPath()
      ctx.ellipse(-size * 0.36, -size * 0.42, size * 0.3, size * 0.14, -0.35, 0, Math.PI * 2)
      ctx.ellipse(size * 0.36, -size * 0.42, size * 0.3, size * 0.14, 0.35, 0, Math.PI * 2)
      ctx.fill()

      ctx.fillStyle = '#C9342E'
      ctx.beginPath()
      ctx.ellipse(-size * 0.24, -size * 0.32, size * 0.24, size * 0.13, 0.25, 0, Math.PI * 2)
      ctx.ellipse(size * 0.24, -size * 0.32, size * 0.24, size * 0.13, -0.25, 0, Math.PI * 2)
      ctx.fill()

      ctx.fillStyle = '#FF4D46'
      for (const bx of [-size * 0.08, size * 0.08, 0]) {
        ctx.beginPath()
        ctx.arc(bx, -size * 0.38, size * 0.09, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
    }

    // Helper: Decorated Christmas Tree with Tinsel & Star
    const drawChristmasTree = (baseX: number, baseY: number, treeH: number) => {
      ctx.save()
      const treeW = treeH * 0.74

      ctx.fillStyle = '#5C3A21'
      ctx.fillRect(baseX - treeW * 0.1, baseY - treeH * 0.14, treeW * 0.2, treeH * 0.14)

      const tiers = [
        { bottomY: baseY - treeH * 0.11, topY: baseY - treeH * 0.52, halfW: treeW * 0.52 },
        { bottomY: baseY - treeH * 0.36, topY: baseY - treeH * 0.76, halfW: treeW * 0.41 },
        { bottomY: baseY - treeH * 0.6, topY: baseY - treeH * 0.96, halfW: treeW * 0.29 }
      ]

      for (const t of tiers) {
        ctx.fillStyle = '#183D32'
        ctx.beginPath()
        ctx.moveTo(baseX, t.topY)
        ctx.lineTo(baseX - t.halfW, t.bottomY)
        ctx.lineTo(baseX + t.halfW, t.bottomY)
        ctx.closePath()
        ctx.fill()

        ctx.strokeStyle = '#DFC492'
        ctx.lineWidth = 1.6
        ctx.stroke()
      }

      drawSparkle(baseX, baseY - treeH, treeH * 0.14, '#FFD54F')

      const ornaments = [
        { ox: -0.2, oy: -0.22, c: '#E53935' },
        { ox: 0.18, oy: -0.26, c: '#FFD54F' },
        { ox: 0.0, oy: -0.32, c: '#69F0AE' },
        { ox: -0.13, oy: -0.46, c: '#FFD54F' },
        { ox: 0.14, oy: -0.5, c: '#E53935' },
        { ox: 0.0, oy: -0.7, c: '#E53935' }
      ]
      for (const o of ornaments) {
        ctx.fillStyle = o.c
        ctx.beginPath()
        ctx.arc(
          baseX + treeW * o.ox,
          baseY + treeH * o.oy,
          Math.max(3.2, treeH * 0.048),
          0,
          Math.PI * 2
        )
        ctx.fill()
      }
      ctx.restore()
    }

    // Helper: Wrapped Holiday Gift Box with Ribbon & Bow
    const drawGiftBox = (
      cx: number,
      baseY: number,
      boxW: number,
      boxH: number,
      boxColor: string,
      ribbonColor: string
    ) => {
      ctx.save()
      const left = cx - boxW * 0.5
      const top = baseY - boxH

      ctx.fillStyle = boxColor
      ctx.fillRect(left, top, boxW, boxH)
      ctx.strokeStyle = '#DFC492'
      ctx.lineWidth = 1.5
      ctx.strokeRect(left, top, boxW, boxH)

      ctx.fillStyle = ribbonColor
      ctx.fillRect(cx - boxW * 0.1, top, boxW * 0.2, boxH)
      ctx.fillRect(left, top + boxH * 0.4, boxW, boxH * 0.18)

      ctx.beginPath()
      ctx.ellipse(cx - boxW * 0.16, top - 2, boxW * 0.16, boxH * 0.12, -0.3, 0, Math.PI * 2)
      ctx.ellipse(cx + boxW * 0.16, top - 2, boxW * 0.16, boxH * 0.12, 0.3, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    // 3. Hanging Baubles & Corner Bells
    const bellSize = Math.max(28, Math.round(minDim * 0.058))
    drawHangingBauble(width * 0.2, borderW, minDim * 0.045, minDim * 0.022, '#B53B35')
    drawHangingBauble(width * 0.8, borderW, minDim * 0.045, minDim * 0.022, '#183D32')
    drawHangingBauble(width * 0.11, borderW, minDim * 0.075, minDim * 0.019, '#D9A441')
    drawHangingBauble(width * 0.89, borderW, minDim * 0.075, minDim * 0.019, '#B53B35')

    drawGoldenBells(borderW + bellSize * 1.1, borderW + bellSize * 0.9, bellSize)
    drawGoldenBells(width - borderW - bellSize * 1.1, borderW + bellSize * 0.9, bellSize)

    // 4. Festive Top Holiday Banner
    const pillW = Math.max(225, Math.round(width * 0.56))
    const pillH = Math.max(32, Math.round(minDim * 0.054))
    const pillX = (width - pillW) * 0.5
    const pillY = borderW + Math.round(minDim * 0.018)

    ctx.fillStyle = '#B53B35'
    ctx.fillRect(pillX, pillY, pillW, pillH)
    ctx.strokeStyle = '#FFE082'
    ctx.lineWidth = 2.2
    ctx.strokeRect(pillX, pillY, pillW, pillH)

    const fontSize = Math.max(11, Math.round(pillH * 0.44))
    ctx.font = `700 ${fontSize}px "Space Mono", monospace`
    ctx.fillStyle = '#FAF7F0'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('🎄 MERRY CHRISTMAS · JMALL ’26 🔔', width * 0.5, pillY + pillH * 0.52)

    // 5. Bottom Snow Drifts + Trees + Gift Boxes
    const floorY = height - borderW
    ctx.fillStyle = 'rgba(250, 247, 240, 0.92)'
    ctx.beginPath()
    ctx.moveTo(borderW, floorY)
    ctx.quadraticCurveTo(width * 0.25, floorY - minDim * 0.032, width * 0.5, floorY - minDim * 0.014)
    ctx.quadraticCurveTo(width * 0.75, floorY - minDim * 0.035, width - borderW, floorY)
    ctx.closePath()
    ctx.fill()

    const treeH = Math.max(88, Math.round(minDim * 0.175))
    drawChristmasTree(borderW + treeH * 0.48, floorY, treeH)
    drawChristmasTree(borderW + treeH * 0.92, floorY, treeH * 0.68)
    drawGiftBox(
      borderW + treeH * 0.72,
      floorY,
      treeH * 0.26,
      treeH * 0.22,
      '#B53B35',
      '#FFD54F'
    )

    drawChristmasTree(width - borderW - treeH * 0.46, floorY, treeH * 0.92)
    drawChristmasTree(width - borderW - treeH * 0.88, floorY, treeH * 0.65)
    drawGiftBox(
      width - borderW - treeH * 0.68,
      floorY,
      treeH * 0.25,
      treeH * 0.22,
      '#183D32',
      '#E53935'
    )

    // 6. Snowflakes & Stars along frame
    drawSnowflake(width * 0.13, height * 0.24, minDim * 0.024)
    drawSnowflake(width * 0.87, height * 0.26, minDim * 0.022)
    drawSnowflake(width * 0.1, height * 0.55, minDim * 0.02)
    drawSnowflake(width * 0.9, height * 0.52, minDim * 0.022)

    drawSparkle(width * 0.24, height * 0.19, minDim * 0.016)
    drawSparkle(width * 0.76, height * 0.2, minDim * 0.016)
    drawSparkle(width * 0.15, height * 0.68, minDim * 0.015)
    drawSparkle(width * 0.85, height * 0.66, minDim * 0.016)

    ctx.restore()
    return
  }
}

/**
 * Applies authentic 35mm disposable camera film processing on a 2D Canvas context:
 * 1. Vintage Color Grading Filter (6 selectable presets)
 * 2. Optional Xenon Flash center-weighted illumination boost
 * 3. Film Grain (luminance-aware analog silver halide noise)
 * 4. Optical Vignette
 * 5. Selected Frame Overlay + Quartz Date Stamp
 */
export function applyFilmEffectsToContext(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  config: FilmEffectConfig,
  shotNumber: number,
  capturedAtIso: string
): void {
  const imageData = ctx.getImageData(0, 0, width, height)
  const data = imageData.data

  const centerX = width * 0.5
  const centerY = height * 0.5
  const maxDist = Math.sqrt(centerX * centerX + centerY * centerY) || 1

  const grainScale = Math.max(0, Math.min(1, config.grainIntensity)) * 34
  const preset = config.warmthPreset

  for (let y = 0; y < height; y++) {
    const dy = y - centerY
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      let r = data[idx]
      let g = data[idx + 1]
      let b = data[idx + 2]

      // 1. Simulated Xenon Flash illumination
      if (config.flashActive) {
        const dx = x - centerX
        const normDist = Math.sqrt(dx * dx + dy * dy) / maxDist
        const flashFactor = Math.max(0, 1 - normDist * 0.92)
        const boost = 1 + flashFactor * 0.24
        r = r * boost + flashFactor * 14
        g = g * boost + flashFactor * 10
        b = b * boost + flashFactor * 5
      }

      // 2. Filter Presets
      if (preset === 'retro-bw') {
        // High-contrast Ilford HP5 400 Black & White silver gelatin curve
        const bwLuma = 0.31 * r + 0.59 * g + 0.1 * b
        const contrasted = 18 + Math.pow(bwLuma / 255, 1.08) * 226
        r = contrasted * 1.01 // subtle warm silver tint
        g = contrasted
        b = contrasted * 0.98
      } else if (preset === 'polaroid-fade') {
        // 90s Instant Film: lifted creamy shadows, pastel highlights, warm nostalgia
        r = 28 + (r / 255) * 212
        g = 24 + (g / 255) * 210
        b = 30 + (b / 255) * 198
        r = r * 1.05 + 6
        g = g * 1.02 + 4
        b = b * 0.94 + 2
      } else if (preset === 'cyber-xmas') {
        // Night Neon / Rooftop 800: punchy contrast, cool shadows, glowing warm highlights
        const lumaOrig = 0.299 * r + 0.587 * g + 0.114 * b
        if (lumaOrig < 120) {
          r = r * 0.94
          g = g * 1.02 + 4
          b = b * 1.12 + 10
        } else {
          r = r * 1.12 + 10
          g = g * 1.01 + 2
          b = b * 0.92
        }
      } else {
        // Classic 35mm negative base (Kodak Gold, Fuji Warm, Holiday Velvet)
        r = 16 + (r / 255) * 228
        g = 14 + (g / 255) * 226
        b = 18 + (b / 255) * 216

        if (preset === 'kodak-gold') {
          r = r * 1.07 + 8
          g = g * 1.02 + 3
          b = b * 0.9 - 4
        } else if (preset === 'fuji-warm') {
          r = r * 1.04 + 5
          g = g * 1.05 + 5
          b = b * 0.93
        } else if (preset === 'holiday-velvet') {
          r = r * 1.1 + 11
          g = g * 0.99 + 2
          b = b * 0.88 - 3
        }

        const luma = 0.299 * r + 0.587 * g + 0.114 * b
        const satFactor = 0.89
        r = luma + (r - luma) * satFactor
        g = luma + (g - luma) * satFactor
        b = luma + (b - luma) * satFactor
      }

      // 3. Luminance-weighted Analog Film Grain
      if (grainScale > 0) {
        const lumaNow = 0.299 * r + 0.587 * g + 0.114 * b
        const midtoneWeight = 1 - Math.abs(lumaNow - 128) / 180
        const noise = (Math.random() - 0.5) * grainScale * Math.max(0.35, midtoneWeight)
        r += noise * 1.04
        g += noise
        b += noise * 0.96
      }

      data[idx] = clampByte(r)
      data[idx + 1] = clampByte(g)
      data[idx + 2] = clampByte(b)
    }
  }

  ctx.putImageData(imageData, 0, 0)

  // 4. Subtle Optical Vignette
  if (config.vignetteIntensity > 0) {
    const outerRadius = Math.max(width, height) * 0.76
    const innerRadius = Math.min(width, height) * 0.28
    const gradient = ctx.createRadialGradient(
      centerX,
      centerY,
      innerRadius,
      centerX,
      centerY,
      outerRadius
    )
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)')
    gradient.addColorStop(0.65, `rgba(22, 16, 12, ${config.vignetteIntensity * 0.35})`)
    gradient.addColorStop(1, `rgba(12, 10, 8, ${config.vignetteIntensity * 0.92})`)

    ctx.save()
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)
    ctx.restore()
  }

  // 5. Camera Frame Overlay Preset
  const resolvedOverlay: FilmOverlayPreset =
    config.overlayPreset || (config.filmFrameOverlay ? '35mm-film' : 'none')
  drawOverlayPreset(ctx, width, height, resolvedOverlay, shotNumber)

  // 6. Quartz Date & Time Stamp
  if (config.dateStamp) {
    ctx.save()
    const stampText = formatDisposableDateStamp(capturedAtIso)
    const minDim = Math.min(width, height)
    const isPolaroid = resolvedOverlay === 'polaroid'
    const borderOffset =
      resolvedOverlay === '35mm-film'
        ? Math.max(18, Math.round(minDim * 0.036))
        : isPolaroid
          ? Math.max(24, Math.round(minDim * 0.055))
          : 14
    const bottomExtra = isPolaroid ? Math.max(68, Math.round(height * 0.135)) : borderOffset

    const fontSize = Math.max(15, Math.round(minDim * 0.032))
    ctx.font = `700 ${fontSize}px "Space Mono", monospace`
    ctx.textAlign = 'right'
    ctx.textBaseline = 'bottom'

    const posX = width - borderOffset - Math.round(fontSize * 0.65)
    const posY = height - bottomExtra - Math.round(fontSize * 0.55)

    ctx.shadowColor = 'rgba(255, 78, 0, 0.85)'
    ctx.shadowBlur = 8
    ctx.fillStyle = '#FF9233'
    ctx.fillText(stampText, posX, posY)

    ctx.shadowBlur = 2
    ctx.fillStyle = '#FFB35C'
    ctx.fillText(stampText, posX, posY)
    ctx.restore()
  }
}

/**
 * Re-applies new Filter or Overlay settings to an already-captured clean source canvas
 * so guests can also switch filters/overlays live in the preview modal before uploading!
 *
 * Dual-Image Storage Architecture:
 * - VERSION A (HD Original): Preserves full captured resolution (`origCanvas.width x origCanvas.height`)
 *   at full 1.0 quality without compression or resizing.
 * - VERSION B (Compressed Copy): Resized up to max 1920x1920 maintaining aspect ratio,
 *   encoded as JPEG at 0.75 quality, and converted to Base64 for Firestore.
 */
export async function reprocessCapturedFrame(
  origCanvas: HTMLCanvasElement,
  rawOriginalBlob: Blob,
  originalPreviewDataUrl: string,
  config: FilmEffectConfig,
  shotNumber: number,
  capturedAtIso: string
): Promise<ProcessedFilmFrame> {
  const hdWidth = origCanvas.width
  const hdHeight = origCanvas.height

  // 1. Apply disposable-camera effects onto the full-resolution HD canvas
  const hdEffectsCanvas = document.createElement('canvas')
  hdEffectsCanvas.width = hdWidth
  hdEffectsCanvas.height = hdHeight
  const hdEffectsCtx = hdEffectsCanvas.getContext('2d')
  if (!hdEffectsCtx) {
    throw new Error('Could not initialize 2D Canvas context for film effects.')
  }

  hdEffectsCtx.drawImage(origCanvas, 0, 0)
  applyFilmEffectsToContext(hdEffectsCtx, hdWidth, hdHeight, config, shotNumber, capturedAtIso)

  // 2. VERSION A — Preserve the full-resolution HD Original Blob (100% quality, never downscaled)
  const hdOriginalBlob = await canvasToJpegBlob(hdEffectsCanvas, 1.0)

  // 3. VERSION B — Generate compressed JPEG copy (max 1920x1920, 0.75 quality) + Base64
  const compressed = await compressCanvasForFirestore(hdEffectsCanvas, {
    maxDimension: MAX_COMPRESSED_DIMENSION,
    quality: DEFAULT_COMPRESSED_JPEG_QUALITY,
    sourceWidth: hdWidth,
    sourceHeight: hdHeight
  })

  return {
    processedBlob: compressed.compressedBlob,
    compressedBase64: compressed.compressedBase64,
    originalBlob: hdOriginalBlob,
    rawOriginalBlob,
    previewDataUrl: compressed.compressedBase64,
    originalPreviewDataUrl,
    width: compressed.width,
    height: compressed.height,
    originalWidth: hdWidth,
    originalHeight: hdHeight,
    sourceCanvas: origCanvas,
    effectsCanvas: hdEffectsCanvas
  }
}

/**
 * Captures a frame from a video or image element:
 * - Preserves the full native resolution HD original without downscaling or quality reduction
 * - Applies disposable-camera effects
 * - Generates the resized (max 1920x1920) 75% JPEG compressed version for Firestore
 */
export async function processCameraFrame(
  source: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement,
  sourceWidth: number,
  sourceHeight: number,
  mirrorHorizontal: boolean,
  config: FilmEffectConfig,
  shotNumber: number,
  capturedAtIso = new Date().toISOString()
): Promise<ProcessedFilmFrame> {
  // Preserve full captured HD resolution for Version A (HD Original)
  const hdWidth = Math.max(1, Math.round(sourceWidth || 1080))
  const hdHeight = Math.max(1, Math.round(sourceHeight || 1440))

  const origCanvas = document.createElement('canvas')
  origCanvas.width = hdWidth
  origCanvas.height = hdHeight
  const origCtx = origCanvas.getContext('2d')
  if (!origCtx) {
    throw new Error('Could not initialize 2D Canvas context for image capture.')
  }

  origCtx.save()
  if (mirrorHorizontal) {
    origCtx.translate(hdWidth, 0)
    origCtx.scale(-1, 1)
  }
  origCtx.drawImage(source, 0, 0, hdWidth, hdHeight)
  origCtx.restore()

  const originalPreviewDataUrl = origCanvas.toDataURL('image/jpeg', 1.0)
  const rawOriginalBlob = await canvasToJpegBlob(origCanvas, 1.0)

  return await reprocessCapturedFrame(
    origCanvas,
    rawOriginalBlob,
    originalPreviewDataUrl,
    config,
    shotNumber,
    capturedAtIso
  )
}
