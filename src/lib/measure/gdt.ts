import type { Vec3 } from "@/lib/geom"
import { cross, dot, normalize, norm, rejectFrom, sub } from "@/lib/math/linalg"

/**
 * 形位公差评价。本模块统一按最小二乘基准评价，数值略大于或等于最小区域法结果；
 * 需要严格按 GB/T 1958 最小区域法验收时，须另行实现并以标准件比对。
 */

function range(values: number[]): number {
  return Math.max(...values) - Math.min(...values)
}

/** 位置度（直径值）：在零件坐标系下，实测圆心与理论圆心在垂直于轴线平面内偏差的 2 倍。 */
export function positionDiameter(measuredPart: Vec3, nominalPart: Vec3): number {
  return 2 * Math.hypot(measuredPart.x - nominalPart.x, measuredPart.y - nominalPart.y)
}

/** 同轴度（直径值）：被测圆心到基准轴线的垂直距离的 2 倍。 */
export function coaxiality(datumPoint: Vec3, datumAxis: Vec3, featureCenter: Vec3): number {
  const axis = normalize(datumAxis)
  return 2 * norm(cross(sub(featureCenter, datumPoint), axis))
}

/** 平行度：被测面上各点沿基准法向的变动量。 */
export function parallelism(surfacePoints: Vec3[], datumNormal: Vec3): number {
  const n = normalize(datumNormal)
  return range(surfacePoints.map((p) => dot(p, n)))
}

/**
 * 垂直度：公差带为两个垂直于基准平面的平行平面，其方向取被测面法向在
 * 基准平面内的投影。
 */
export function perpendicularity(surfacePoints: Vec3[], featureNormal: Vec3, datumNormal: Vec3): number {
  const m = normalize(rejectFrom(featureNormal, normalize(datumNormal)))
  return range(surfacePoints.map((p) => dot(p, m)))
}
