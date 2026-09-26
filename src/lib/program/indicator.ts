import type { Vec3 } from "@/lib/geom"

/** 千分表沿一条边往复：位置是测针（或表座）的机床坐标，读数是表针示值（mm）。 */
export type IndicatorReading = {
  position: Vec3
  readingMm: number
}

export type IndicatorResult = {
  /** 行程最长的轴，表针示值相对它的斜率就是这条边的转角。 */
  travel: "x" | "y"
  spanMm: number
  /** 绕 Z 的转角（度）。正值表示沿行程正向，读数增大。 */
  angleDeg: number
  /** 去掉倾斜后的读数峰峰值，用来看这条边直不直。 */
  variationMm: number
}

/**
 * 至少两个点，行程不短于 5 mm。
 * 表针接触的是基准边，沿行程轴移动时读数的斜率 atan(Δ读数/Δ行程) 就是边相对该轴的夹角。
 */
export function indicateEdge(readings: IndicatorReading[]): IndicatorResult | null {
  if (readings.length < 2) return null
  const xs = readings.map((r) => r.position.x)
  const ys = readings.map((r) => r.position.y)
  const spanX = Math.max(...xs) - Math.min(...xs)
  const spanY = Math.max(...ys) - Math.min(...ys)
  const travel = spanX >= spanY ? "x" : "y"
  const span = travel === "x" ? spanX : spanY
  if (span < 5) return null
  const coord = readings.map((r) => (travel === "x" ? r.position.x : r.position.y))
  const meanT = coord.reduce((s, v) => s + v, 0) / coord.length
  const meanR = readings.reduce((s, r) => s + r.readingMm, 0) / readings.length
  let num = 0
  let den = 0
  for (let i = 0; i < readings.length; i++) {
    const dt = coord[i] - meanT
    num += dt * (readings[i].readingMm - meanR)
    den += dt * dt
  }
  const slope = den === 0 ? 0 : num / den
  const residuals = readings.map((r, i) => r.readingMm - (meanR + slope * (coord[i] - meanT)))
  const variation = Math.max(...residuals) - Math.min(...residuals)
  return {
    travel,
    spanMm: span,
    angleDeg: (Math.atan(slope) * 180) / Math.PI,
    variationMm: variation,
  }
}

/** 测头没测基准边时，把千分表转角加进工件坐标系的绕 Z。已经 3-2-1 找正过就不要再加。 */
export function applyDialYaw<T extends { rz: number }>(pose: T, dial: IndicatorResult | null, use: boolean): T {
  if (!use || !dial) return pose
  return { ...pose, rz: pose.rz + dial.angleDeg }
}
