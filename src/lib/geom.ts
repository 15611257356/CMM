export type Vec3 = { x: number; y: number; z: number }
export type Axis = "x" | "y" | "z"

/** 预检机行程 500×400×300（与项目书一致），机械原点在 X0 Y0 Z 最高点。 */
export const MACHINE = {
  xMin: 0,
  xMax: 500,
  yMin: 0,
  yMax: 400,
  zMin: 0,
  zMax: 300,
  home: { x: 0, y: 0, z: 300 } satisfies Vec3,
}

export function cloneVec(v: Vec3): Vec3 {
  return { x: v.x, y: v.y, z: v.z }
}

export function dist(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return Math.hypot(dx, dy, dz)
}

export function lerpVec(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`
}

export function formatMm(value: number, digits = 4): string {
  return Number.isFinite(value) ? `${value.toFixed(digits)} mm` : "—"
}
