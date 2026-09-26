import type { Vec3 } from "@/lib/geom"
import type { CircleFit, LineFit, PlaneFit } from "@/lib/measure/fit"
import { add, cross, dot, normalize, rejectFrom, scale, sub } from "@/lib/math/linalg"
import { fromAxes, type RigidTransform } from "@/lib/math/transform"

/**
 * 3-2-1 找正，返回「零件坐标系 → 机床坐标系」的变换。
 * - 第一基准面：确定 Z 轴方向和 Z0；
 * - 第二基准线：投影到第一基准面后确定 X 轴方向和 Y0；
 * - 原点：确定 X0。
 * zHint / xHint 用于给轴线定正方向（以名义装夹下零件轴在机床中的方向为准）。
 */
export function align321(
  primary: PlaneFit,
  secondary: LineFit,
  originPoint: Vec3,
  hints: { zHint: Vec3; xHint: Vec3 }
): RigidTransform {
  let z = normalize(primary.normal)
  if (dot(z, hints.zHint) < 0) z = scale(z, -1)
  let x = normalize(rejectFrom(secondary.direction, z))
  if (dot(x, hints.xHint) < 0) x = scale(x, -1)
  const y = cross(z, x)
  const origin = add(
    add(scale(z, dot(primary.point, z)), scale(y, dot(secondary.point, y))),
    scale(x, dot(originPoint, x))
  )
  return fromAxes(origin, x, y, z)
}

/**
 * 一面两孔找正：第一孔中心为原点（投影到基准面），第一孔→第二孔方向为 X 轴。
 * nominalAngle 为两孔连线在零件坐标系中的理论角度（弧度）。
 */
export function alignPlaneTwoHoles(
  primary: PlaneFit,
  hole1: CircleFit,
  hole2: CircleFit,
  hints: { zHint: Vec3; nominalHole1: Vec3; nominalAngle: number }
): RigidTransform {
  let z = normalize(primary.normal)
  if (dot(z, hints.zHint) < 0) z = scale(z, -1)
  const c1 = sub(hole1.center, scale(z, dot(sub(hole1.center, primary.point), z)))
  const c2 = sub(hole2.center, scale(z, dot(sub(hole2.center, primary.point), z)))
  const along = normalize(sub(c2, c1))
  const cosA = Math.cos(hints.nominalAngle)
  const sinA = Math.sin(hints.nominalAngle)
  const perp = cross(z, along)
  const x = normalize(add(scale(along, cosA), scale(perp, -sinA)))
  const y = cross(z, x)
  const n = hints.nominalHole1
  const origin = sub(sub(sub(c1, scale(x, n.x)), scale(y, n.y)), scale(z, n.z))
  return fromAxes(origin, x, y, z)
}
