import { uid } from "@/lib/geom"
import { PLATE } from "@/lib/machine/setup"
import { imageToPart } from "@/lib/vision/sample-image"
import type { DetectedCircle, VisionCalibration } from "@/lib/vision/types"

type Blob = {
  pixels: { x: number; y: number }[]
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function grayscale(data: Uint8ClampedArray): Uint8Array {
  const out = new Uint8Array(data.length / 4)
  for (let i = 0; i < out.length; i++) {
    const o = i * 4
    out[i] = (data[o] * 0.299 + data[o + 1] * 0.587 + data[o + 2] * 0.114) | 0
  }
  return out
}

function connectedComponents(mask: Uint8Array, w: number, h: number): Blob[] {
  const seen = new Uint8Array(mask.length)
  const blobs: Blob[] = []
  const stack: number[] = []

  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue
    stack.push(i)
    seen[i] = 1
    const pixels: { x: number; y: number }[] = []
    let minX = w,
      minY = h,
      maxX = 0,
      maxY = 0
    while (stack.length) {
      const idx = stack.pop() as number
      const x = idx % w
      const y = (idx / w) | 0
      pixels.push({ x, y })
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
      const neigh = [idx + 1, idx - 1, idx + w, idx - w]
      for (const n of neigh) {
        if (n < 0 || n >= mask.length || seen[n] || !mask[n]) continue
        seen[n] = 1
        stack.push(n)
      }
    }
    blobs.push({ pixels, minX, minY, maxX, maxY })
  }
  return blobs
}

function buildMask(gray: Uint8Array, threshold: number, invert: boolean): Uint8Array {
  const mask = new Uint8Array(gray.length)
  for (let i = 0; i < gray.length; i++) {
    const dark = gray[i] < threshold
    mask[i] = (invert ? !dark : dark) ? 1 : 0
  }
  return mask
}

function blobsToCircles(blobs: Blob[], cal: VisionCalibration): DetectedCircle[] {
  const minArea = 80
  const maxArea = (cal.imageWidth * cal.imageHeight) / 8
  const circles: DetectedCircle[] = []

  for (const blob of blobs) {
    const area = blob.pixels.length
    if (area < minArea || area > maxArea) continue
    const bw = blob.maxX - blob.minX + 1
    const bh = blob.maxY - blob.minY + 1
    const aspect = bw / bh
    if (aspect < 0.65 || aspect > 1.45) continue
    let sx = 0,
      sy = 0
    for (const p of blob.pixels) {
      sx += p.x
      sy += p.y
    }
    const cx = sx / area
    const cy = sy / area
    const radiusPx = Math.sqrt(area / Math.PI)
    const boxR = Math.max(bw, bh) / 2
    if (Math.abs(radiusPx - boxR) / boxR > 0.45) continue
    const part = imageToPart(cx, cy, cal)
    const radius = (radiusPx / (cal.imageWidth - cal.padX * 2)) * PLATE.w
    circles.push({
      id: uid("vis"),
      px: cx,
      py: cy,
      radiusPx,
      x: part.x,
      y: part.y,
      z: 0,
      radius,
    })
  }
  return circles
}

export function detectCircles(image: ImageData, cal: VisionCalibration): DetectedCircle[] {
  const gray = grayscale(image.data)
  const attempts: Array<{ t: number; invert: boolean }> = [
    { t: 70, invert: false },
    { t: 90, invert: false },
    { t: 50, invert: false },
    { t: 140, invert: true },
  ]
  let best: DetectedCircle[] = []
  for (const attempt of attempts) {
    const mask = buildMask(gray, attempt.t, attempt.invert)
    const circles = blobsToCircles(connectedComponents(mask, image.width, image.height), cal)
    if (circles.length > best.length) best = circles
    if (best.length >= 4) break
  }
  return best.sort((a, b) => a.y - b.y || a.x - b.x)
}

export async function imageDataFromUrl(url: string): Promise<ImageData> {
  const img = new Image()
  img.src = url
  await img.decode()
  const canvas = document.createElement("canvas")
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("无法读取图像")
  ctx.drawImage(img, 0, 0)
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}
