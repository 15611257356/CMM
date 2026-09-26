import type { Vec3 } from "@/lib/geom"
import {
  add,
  centroid,
  cross,
  dot,
  normalize,
  orthonormalBasis,
  rejectFrom,
  scale,
  scatterMatrix,
  solveLinear,
  sub,
  symmetricEigen3,
} from "@/lib/math/linalg"

export type PlaneFit = {
  /** 单位法向，指向材料外侧（测头所在一侧）。 */
  normal: Vec3
  point: Vec3
  residuals: number[]
  flatness: number
}

export type LineFit = {
  direction: Vec3
  point: Vec3
  /** 在参考平面内、垂直于直线方向的有符号偏差。 */
  residuals: number[]
  straightness: number
}

export type CircleFit = {
  center: Vec3
  /** 圆所在平面的法向（孔/轴的轴线方向）。 */
  normal: Vec3
  radius: number
  residuals: number[]
  circularity: number
}

export type SphereFit = {
  center: Vec3
  radius: number
  residuals: number[]
  form: number
}

function range(values: number[]): number {
  return Math.max(...values) - Math.min(...values)
}

/** 总体最小二乘平面（PCA），任意朝向都可以，竖直的基准侧面同样适用。 */
export function fitPlane(points: Vec3[], outwardHint: Vec3): PlaneFit {
  if (points.length < 3) throw new Error("平面拟合至少需要 3 个点")
  const c = centroid(points)
  const { values, vectors } = symmetricEigen3(scatterMatrix(points, c))
  if (values[1] < 1e-12) throw new Error("平面拟合失败：点几乎共线")
  let normal = normalize(vectors[0])
  if (dot(normal, outwardHint) < 0) normal = scale(normal, -1)
  const residuals = points.map((p) => dot(sub(p, c), normal))
  return { normal, point: c, residuals, flatness: range(residuals) }
}

/**
 * 空间直线拟合。referenceNormal 给出直线所在测量平面的法向（例如基准侧边的
 * 边线落在水平面内时传 +Z），偏差按平面内垂直于直线的方向计算。
 */
export function fitLine(points: Vec3[], referenceNormal: Vec3, directionHint: Vec3): LineFit {
  if (points.length < 2) throw new Error("直线拟合至少需要 2 个点")
  const c = centroid(points)
  let direction: Vec3
  if (points.length === 2) {
    direction = normalize(sub(points[1], points[0]))
  } else {
    const { vectors } = symmetricEigen3(scatterMatrix(points, c))
    direction = normalize(vectors[2])
  }
  if (dot(direction, directionHint) < 0) direction = scale(direction, -1)
  const lateral = normalize(cross(referenceNormal, direction))
  const residuals = points.map((p) => dot(sub(p, c), lateral))
  return { direction, point: c, residuals, straightness: range(residuals) }
}

function kasa2d(pts: { u: number; v: number }[]): { cu: number; cv: number; r: number } {
  let suu = 0,
    svv = 0,
    suv = 0,
    su = 0,
    sv = 0,
    suz = 0,
    svz = 0,
    sz = 0
  for (const { u, v } of pts) {
    const z = u * u + v * v
    suu += u * u
    svv += v * v
    suv += u * v
    su += u
    sv += v
    suz += u * z
    svz += v * z
    sz += z
  }
  const sol = solveLinear(
    [
      [suu, suv, su],
      [suv, svv, sv],
      [su, sv, pts.length],
    ],
    [suz, svz, sz]
  )
  if (!sol) throw new Error("圆拟合失败：点几乎共线")
  const cu = sol[0] / 2
  const cv = sol[1] / 2
  const r = Math.sqrt(Math.max(0, sol[2] + cu * cu + cv * cv))
  return { cu, cv, r }
}

/** 几何最小二乘圆（Gauss-Newton，以 Kåsa 解为初值）。 */
function geometricCircle2d(pts: { u: number; v: number }[]): { cu: number; cv: number; r: number } {
  let { cu, cv, r } = kasa2d(pts)
  for (let iter = 0; iter < 30; iter++) {
    const JtJ = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ]
    const Jtr = [0, 0, 0]
    for (const p of pts) {
      const du = p.u - cu
      const dv = p.v - cv
      const d = Math.hypot(du, dv) || 1e-12
      const res = d - r
      const J = [-du / d, -dv / d, -1]
      for (let i = 0; i < 3; i++) {
        Jtr[i] += J[i] * res
        for (let j = 0; j < 3; j++) JtJ[i][j] += J[i] * J[j]
      }
    }
    const step = solveLinear(JtJ, Jtr.map((x) => -x))
    if (!step) break
    cu += step[0]
    cv += step[1]
    r += step[2]
    if (Math.hypot(step[0], step[1], step[2]) < 1e-12) break
  }
  return { cu, cv, r: Math.abs(r) }
}

/**
 * 空间圆拟合。axisHint 为孔/轴的名义轴线方向：点数 ≥ 4 且不共面时用 PCA 求平面，
 * 否则直接用名义轴线作为圆平面法向。
 */
export function fitCircle(points: Vec3[], axisHint: Vec3): CircleFit {
  if (points.length < 3) throw new Error("圆拟合至少需要 3 个点")
  const c = centroid(points)
  let normal = normalize(axisHint)
  if (points.length >= 4) {
    const { values, vectors } = symmetricEigen3(scatterMatrix(points, c))
    const planar = values[0] / Math.max(values[1], 1e-12)
    if (values[1] > 1e-9 && planar < 1e-4) normal = normalize(vectors[0])
  }
  if (dot(normal, axisHint) < 0) normal = scale(normal, -1)
  const { u, v } = orthonormalBasis(normal)
  const pts = points.map((p) => {
    const d = sub(p, c)
    return { u: dot(d, u), v: dot(d, v) }
  })
  const fit = geometricCircle2d(pts)
  const center = add(c, add(scale(u, fit.cu), scale(v, fit.cv)))
  const residuals = pts.map((p) => Math.hypot(p.u - fit.cu, p.v - fit.cv) - fit.r)
  return { center, normal, radius: fit.r, residuals, circularity: range(residuals) }
}

/** 几何最小二乘球，用于标准球标定测头与托盘零点。 */
export function fitSphere(points: Vec3[]): SphereFit {
  if (points.length < 4) throw new Error("球拟合至少需要 4 个点")
  const A = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]
  const b = [0, 0, 0, 0]
  for (const p of points) {
    const row = [p.x, p.y, p.z, 1]
    const rhs = p.x * p.x + p.y * p.y + p.z * p.z
    for (let i = 0; i < 4; i++) {
      b[i] += row[i] * rhs
      for (let j = 0; j < 4; j++) A[i][j] += row[i] * row[j]
    }
  }
  const sol = solveLinear(A, b)
  if (!sol) throw new Error("球拟合失败：点分布退化")
  let center = { x: sol[0] / 2, y: sol[1] / 2, z: sol[2] / 2 }
  let radius = Math.sqrt(Math.max(0, sol[3] + center.x ** 2 + center.y ** 2 + center.z ** 2))
  for (let iter = 0; iter < 30; iter++) {
    const JtJ = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]
    const Jtr = [0, 0, 0, 0]
    for (const p of points) {
      const d = sub(p, center)
      const dist = Math.hypot(d.x, d.y, d.z) || 1e-12
      const res = dist - radius
      const J = [-d.x / dist, -d.y / dist, -d.z / dist, -1]
      for (let i = 0; i < 4; i++) {
        Jtr[i] += J[i] * res
        for (let j = 0; j < 4; j++) JtJ[i][j] += J[i] * J[j]
      }
    }
    const step = solveLinear(JtJ, Jtr.map((x) => -x))
    if (!step) break
    center = { x: center.x + step[0], y: center.y + step[1], z: center.z + step[2] }
    radius += step[3]
    if (Math.hypot(...step) < 1e-12) break
  }
  const residuals = points.map((p) => Math.hypot(p.x - center.x, p.y - center.y, p.z - center.z) - radius)
  return { center, radius: Math.abs(radius), residuals, form: range(residuals) }
}

/**
 * 测针半径补偿。触发式测头记录的是红宝石球心；approach 为触测方向（从测头指向材料）。
 * 做法与商用 CMM 一致：先用球心拟合特征，再把特征沿材料方向偏移一个测针半径。
 */
export const probeCompensation = {
  point(center: Vec3, approach: Vec3, tipRadius: number): Vec3 {
    return add(center, scale(normalize(approach), tipRadius))
  },

  plane(fit: PlaneFit, tipRadius: number): PlaneFit {
    return { ...fit, point: sub(fit.point, scale(fit.normal, tipRadius)) }
  },

  /** lateralToMaterial：平面内垂直于直线、指向材料的方向。 */
  line(fit: LineFit, lateralToMaterial: Vec3, tipRadius: number): LineFit {
    const lateral = normalize(rejectFrom(lateralToMaterial, fit.direction))
    return { ...fit, point: add(fit.point, scale(lateral, tipRadius)) }
  },

  /** inner=true 为孔（球心圆比孔小一个测针半径），false 为轴/凸台。 */
  circle(fit: CircleFit, inner: boolean, tipRadius: number): CircleFit {
    return { ...fit, radius: inner ? fit.radius + tipRadius : fit.radius - tipRadius }
  },

  sphere(fit: SphereFit, tipRadius: number): SphereFit {
    return { ...fit, radius: fit.radius - tipRadius }
  },
}
