import { PLATE } from "@/lib/machine/setup"
import type { VisionCalibration } from "@/lib/vision/types"

export const SAMPLE_SIZE = { width: 480, height: 336, padX: 28, padY: 24 }

export function sampleCalibration(): VisionCalibration {
  return {
    imageWidth: SAMPLE_SIZE.width,
    imageHeight: SAMPLE_SIZE.height,
    padX: SAMPLE_SIZE.padX,
    padY: SAMPLE_SIZE.padY,
  }
}

/** 俯视示意图：图像上方对应零件后侧（Y 大）。 */
export function createSamplePlateImage(): string {
  const { width, height, padX, padY } = SAMPLE_SIZE
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")
  if (!ctx) return ""

  ctx.fillStyle = "#1b1d22"
  ctx.fillRect(0, 0, width, height)

  const pw = width - padX * 2
  const ph = height - padY * 2
  ctx.fillStyle = "#8a8f96"
  ctx.fillRect(padX, padY, pw, ph)
  ctx.fillStyle = "#9aa1aa"
  ctx.fillRect(padX + 6, padY + 6, pw - 12, ph - 12)

  for (const hole of PLATE.holes) {
    const cx = padX + (hole.x / PLATE.w) * pw
    const cy = padY + (1 - hole.y / PLATE.d) * ph
    const r = (hole.r / PLATE.w) * pw
    const g = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.2, r * 0.2, cx, cy, r)
    g.addColorStop(0, "#2a2d33")
    g.addColorStop(1, "#0c0d10")
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.fillStyle = "#c5cad1"
  ctx.font = "12px sans-serif"
  ctx.fillText(`示例工件 · ${PLATE.name}`, padX + 8, padY + 18)
  return canvas.toDataURL("image/png")
}

/** 像素 → 零件坐标（演示标定：板面铺满除边距以外的画面）。 */
export function imageToPart(px: number, py: number, cal: VisionCalibration): { x: number; y: number } {
  const pw = cal.imageWidth - cal.padX * 2
  const ph = cal.imageHeight - cal.padY * 2
  return {
    x: ((px - cal.padX) / pw) * PLATE.w,
    y: (1 - (py - cal.padY) / ph) * PLATE.d,
  }
}
