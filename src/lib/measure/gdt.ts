import type { Vec3 } from "@/lib/geom"

export type PlaneFit = {
  a: number
  b: number
  c: number
  centroid: Vec3
  residuals: number[]
  flatness: number
}

export type CircleFit = {
  cx: number
  cy: number
  cz: number
  radius: number
  residuals: number[]
  circularity: number
}

function solve3(A: number[][], b: number[]): number[] | null {
  const m = A.map((row, i) => [...row, b[i]])
  for (let col = 0; col < 3; col++) {
    let pivot = col
    for (let row = col + 1; row < 3; row++) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row
    }
    if (Math.abs(m[pivot][col]) < 1e-12) return null
    if (pivot !== col) {
      const tmp = m[col]
      m[col] = m[pivot]
      m[pivot] = tmp
    }
    const div = m[col][col]
    for (let j = col; j < 4; j++) m[col][j] /= div
    for (let row = 0; row < 3; row++) {
      if (row === col) continue
      const f = m[row][col]
      for (let j = col; j < 4; j++) m[row][j] -= f * m[col][j]
    }
  }
  return [m[0][3], m[1][3], m[2][3]]
}

/** 最小二乘平面 z = ax + by + c，平面度为最大/最小法向偏差之差。 */
export function fitPlane(points: Vec3[]): PlaneFit {
  if (points.length < 3) {
    throw new Error("平面拟合至少需要 3 个点")
  }
  let sX = 0,
    sY = 0,
    sZ = 0,
    sXX = 0,
    sYY = 0,
    sXY = 0,
    sXZ = 0,
    sYZ = 0
  for (const p of points) {
    sX += p.x
    sY += p.y
    sZ += p.z
    sXX += p.x * p.x
    sYY += p.y * p.y
    sXY += p.x * p.y
    sXZ += p.x * p.z
    sYZ += p.y * p.z
  }
  const n = points.length
  const coeff = solve3(
    [
      [sXX, sXY, sX],
      [sXY, sYY, sY],
      [sX, sY, n],
    ],
    [sXZ, sYZ, sZ]
  )
  if (!coeff) {
    throw new Error("平面拟合失败：点几乎共线")
  }
  const [a, b, c] = coeff
  const norm = Math.hypot(a, b, -1)
  const residuals = points.map((p) => (a * p.x + b * p.y + c - p.z) / norm)
  const flatness = Math.max(...residuals) - Math.min(...residuals)
  return {
    a,
    b,
    c,
    centroid: { x: sX / n, y: sY / n, z: sZ / n },
    residuals,
    flatness,
  }
}

/** Kåsa 代数圆拟合，圆度为最大/最小半径差。 */
export function fitCircle(points: Vec3[]): CircleFit {
  if (points.length < 3) {
    throw new Error("圆拟合至少需要 3 个点")
  }
  let sX = 0,
    sY = 0,
    sZ = 0,
    sXX = 0,
    sYY = 0,
    sXY = 0,
    sXz = 0,
    sYz = 0
  const zs: number[] = []
  for (const p of points) {
    const z = p.x * p.x + p.y * p.y
    sX += p.x
    sY += p.y
    sZ += p.z
    sXX += p.x * p.x
    sYY += p.y * p.y
    sXY += p.x * p.y
    sXz += p.x * z
    sYz += p.y * z
    zs.push(z)
  }
  const n = points.length
  const sZsum = zs.reduce((acc, v) => acc + v, 0)
  const coeff = solve3(
    [
      [sXX, sXY, sX],
      [sXY, sYY, sY],
      [sX, sY, n],
    ],
    [sXz, sYz, sZsum]
  )
  if (!coeff) {
    throw new Error("圆拟合失败：点几乎共线")
  }
  const [D, E, F] = [-coeff[0], -coeff[1], -coeff[2]]
  const cx = -D / 2
  const cy = -E / 2
  const radius = Math.sqrt(Math.max(0, cx * cx + cy * cy - F))
  const radii = points.map((p) => Math.hypot(p.x - cx, p.y - cy))
  const residuals = radii.map((r) => r - radius)
  const circularity = Math.max(...radii) - Math.min(...radii)
  return {
    cx,
    cy,
    cz: sZ / n,
    radius,
    residuals,
    circularity,
  }
}

export function positionDeviation(measured: { x: number; y: number }, nominal: { x: number; y: number }): number {
  return 2 * Math.hypot(measured.x - nominal.x, measured.y - nominal.y)
}

export function coaxiality(a: { cx: number; cy: number }, b: { cx: number; cy: number }): number {
  return 2 * Math.hypot(a.cx - b.cx, a.cy - b.cy)
}
