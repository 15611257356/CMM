export type Vec3 = { x: number; y: number; z: number }
export type Axis = "x" | "y" | "z"

export const MACHINE = {
  xMin: 0,
  xMax: 400,
  yMin: 0,
  yMax: 300,
  zMin: 0,
  zMax: 200,
  home: { x: 0, y: 0, z: 200 } satisfies Vec3,
}

export const PLATE = {
  x: 100,
  y: 80,
  z: 0,
  w: 200,
  d: 140,
  h: 20,
  holes: [
    { id: "A", name: "孔A", x: 140, y: 110, z: 20, r: 10 },
    { id: "B", name: "孔B", x: 260, y: 110, z: 20, r: 10 },
    { id: "C", name: "孔C", x: 140, y: 190, z: 20, r: 10 },
    { id: "D", name: "孔D", x: 260, y: 190, z: 20, r: 10 },
  ],
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

export function easeInOut(t: number): number {
  const x = clamp(t, 0, 1)
  return x * x * (3 - 2 * x)
}

export function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`
}

export function formatMm(value: number, digits = 4): string {
  return `${value.toFixed(digits)} mm`
}
