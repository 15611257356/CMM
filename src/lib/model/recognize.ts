import type { Vec3 } from "@/lib/geom"
import { fitCircle, fitSphere } from "@/lib/measure/fit"
import {
  add,
  centroid,
  cross,
  dot,
  norm,
  normalize,
  orthonormalBasis,
  scale,
  sub,
  symmetricEigen3,
} from "@/lib/math/linalg"
import type { ModelDistance } from "@/lib/model/distance"
import { triNormalArea, triVertex, weldCorners } from "@/lib/model/mesh"
import type { FaceInfo, PartModel } from "@/lib/model/types"
import type { FeatureKind, ProbePoint, ProgramStep } from "@/lib/program/types"

const PLANE_COS = Math.cos((0.5 * Math.PI) / 180)
const CYL_AXIS_DOT = 0.06

const cornerCache = new WeakMap<PartModel, Int32Array>()
function cornersOf(model: PartModel): Int32Array {
  let c = cornerCache.get(model)
  if (!c) {
    c = weldCorners(model.positions)
    cornerCache.set(model, c)
  }
  return c
}

const facesCache = new WeakMap<PartModel, number[][]>()
function facesOf(model: PartModel): number[][] {
  let f = facesCache.get(model)
  if (!f) {
    f = Array.from({ length: model.faceCount }, () => [] as number[])
    for (let t = 0; t < model.faceOf.length; t++) f[model.faceOf[t]]?.push(t)
    facesCache.set(model, f)
  }
  return f
}

function faceVertices(model: PartModel, tris: number[]): Vec3[] {
  const out: Vec3[] = []
  for (const t of tris) for (const k of [0, 1, 2] as const) out.push(triVertex(model.positions, t, k))
  return out
}

/** 识别一个面是平面、圆柱（孔/轴）、球面还是其它曲面。 */
export function analyzeFace(model: PartModel, face: number): FaceInfo {
  const triangles = facesOf(model)[face] ?? []
  const base: FaceInfo = { id: face, kind: "other", triangles, area: 0, residual: Infinity }
  if (!triangles.length) return base
  let area = 0
  let nSum = { x: 0, y: 0, z: 0 }
  const M = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  const normals: { n: Vec3; area: number; c: Vec3 }[] = []
  for (const t of triangles) {
    const { n, area: a } = triNormalArea(model.positions, t)
    if (a <= 0) continue
    const c = scale(
      add(add(triVertex(model.positions, t, 0), triVertex(model.positions, t, 1)), triVertex(model.positions, t, 2)),
      1 / 3
    )
    normals.push({ n, area: a, c })
    area += a
    nSum = add(nSum, scale(n, a))
    const v = [n.x, n.y, n.z]
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[i][j] += a * v[i] * v[j]
  }
  if (!normals.length || area <= 0) return base
  base.area = area

  if (norm(nSum) > 1e-9) {
    const N = normalize(nSum)
    if (normals.every((e) => dot(e.n, N) > PLANE_COS)) {
      const point = scale(
        normals.reduce((acc, e) => add(acc, scale(e.c, e.area)), { x: 0, y: 0, z: 0 }),
        1 / area
      )
      const verts = faceVertices(model, triangles)
      const residual = Math.max(...verts.map((p) => Math.abs(dot(sub(p, point), N))))
      return { ...base, kind: "plane", normal: N, point, residual }
    }
  }

  const { values, vectors } = symmetricEigen3(M)
  const axis = normalize(vectors[0])
  const spread = values[1] / Math.max(values[2], 1e-12)
  if (spread > 0.02 && normals.every((e) => Math.abs(dot(e.n, axis)) < CYL_AXIS_DOT)) {
    const verts = faceVertices(model, triangles)
    try {
      const fit = fitCircle(verts, axis)
      const c0 = fit.center
      let inward = 0
      for (const e of normals) {
        const radial = sub(sub(e.c, c0), scale(axis, dot(sub(e.c, c0), axis)))
        inward += e.area * dot(e.n, radial)
      }
      const axial = verts.map((p) => dot(sub(p, c0), axis))
      const { u, v } = orthonormalBasis(axis)
      const angles = verts.map((p) => {
        const d = sub(p, c0)
        return Math.atan2(dot(d, v), dot(d, u))
      })
      const arc = coveredArc(angles)
      const residual = Math.max(...verts.map((p) => {
        const d = sub(p, c0)
        return Math.abs(norm(sub(d, scale(axis, dot(d, axis)))) - fit.radius)
      }))
      if (residual < Math.max(0.05, fit.radius * 0.01)) {
        return {
          ...base,
          kind: "cylinder",
          axis,
          point: c0,
          radius: fit.radius,
          inner: inward < 0,
          axialMin: Math.min(...axial),
          axialMax: Math.max(...axial),
          arcStart: arc.start,
          arcSpan: arc.span,
          residual,
        }
      }
    } catch {
      /* 退化，继续尝试球面 */
    }
  }

  const verts = faceVertices(model, triangles)
  if (verts.length >= 12) {
    try {
      const s = fitSphere(verts.filter((_, i) => i % 3 === 0))
      const residual = Math.max(...verts.map((p) => Math.abs(norm(sub(p, s.center)) - s.radius)))
      if (residual < Math.max(0.05, s.radius * 0.01)) {
        return { ...base, kind: "sphere", point: s.center, radius: s.radius, residual }
      }
    } catch {
      /* ignore */
    }
  }
  return base
}

/** 一组角度实际覆盖的圆弧：找最大空隙，剩下的就是覆盖范围。 */
function coveredArc(angles: number[]): { start: number; span: number } {
  const sorted = [...angles].sort((a, b) => a - b)
  if (sorted.length < 2) return { start: 0, span: 0 }
  let gap = sorted[0] + Math.PI * 2 - sorted[sorted.length - 1]
  let start = sorted[0]
  for (let i = 1; i < sorted.length; i++) {
    const g = sorted[i] - sorted[i - 1]
    if (g > gap) {
      gap = g
      start = sorted[i]
    }
  }
  return { start, span: Math.PI * 2 - gap }
}

export type FeatureOptions = {
  tipRadius: number
  /** 名义回退距离：测点前的预触点离表面的距离。 */
  retract: number
  distance?: ModelDistance
  name: string
  count?: number
}

export type FeatureBuild = { step: ProgramStep; note?: string } | { error: string }

let seq = 0
function stepId(): string {
  seq += 1
  return `feat-${Date.now().toString(36)}-${seq}`
}

function points(id: string, list: { nominal: Vec3; approach: Vec3 }[]): ProbePoint[] {
  return list.map((p, i) => ({ id: `${id}-pt-${i}`, nominal: p.nominal, approach: normalize(p.approach) }))
}

/** 在面内均匀撒候选点，离面边界至少 margin，保证红宝石球整颗落在面上。 */
function faceCandidates(model: PartModel, info: FaceInfo, margin: number, opts: FeatureOptions): Vec3[] {
  const corners = cornersOf(model)
  const edgeCount = new Map<string, { a: Vec3; b: Vec3; n: number }>()
  for (const t of info.triangles) {
    for (let k = 0; k < 3; k++) {
      const ia = corners[t * 3 + k]
      const ib = corners[t * 3 + ((k + 1) % 3)]
      const key = ia < ib ? `${ia}_${ib}` : `${ib}_${ia}`
      const e = edgeCount.get(key)
      if (e) e.n += 1
      else {
        edgeCount.set(key, {
          a: triVertex(model.positions, t, k as 0 | 1 | 2),
          b: triVertex(model.positions, t, ((k + 1) % 3) as 0 | 1 | 2),
          n: 1,
        })
      }
    }
  }
  const boundary = [...edgeCount.values()].filter((e) => e.n === 1)
  const budget = 700
  const out: Vec3[] = []
  let k = 0
  for (const t of info.triangles) {
    const { area } = triNormalArea(model.positions, t)
    const n = Math.max(1, Math.round((budget * area) / info.area))
    const a = triVertex(model.positions, t, 0)
    const b = triVertex(model.positions, t, 1)
    const c = triVertex(model.positions, t, 2)
    for (let i = 0; i < n; i++) {
      k += 1
      const r1 = Math.sqrt((k * 0.6180339887) % 1)
      const r2 = (k * 0.7548776662) % 1
      const p = add(add(scale(a, 1 - r1), scale(b, r1 * (1 - r2))), scale(c, r1 * r2))
      if (boundaryDistance(p, boundary) < margin) continue
      if (opts.distance && info.normal) {
        const center = add(p, scale(info.normal, opts.tipRadius + 0.05))
        if (opts.distance.distance(center, opts.tipRadius + 1) < opts.tipRadius) continue
      }
      out.push(p)
    }
  }
  return out
}

function boundaryDistance(p: Vec3, edges: { a: Vec3; b: Vec3 }[]): number {
  let best = Infinity
  for (const { a, b } of edges) {
    const ab = sub(b, a)
    const len2 = dot(ab, ab)
    const t = len2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / len2)) : 0
    const d = norm(sub(p, add(a, scale(ab, t))))
    if (d < best) best = d
  }
  return best
}

/** 最远点采样：选出彼此尽量分散的 count 个点。 */
function spreadPoints(candidates: Vec3[], count: number): Vec3[] {
  if (candidates.length <= count) return candidates
  const c = centroid(candidates)
  let first = 0
  for (let i = 1; i < candidates.length; i++) {
    if (norm(sub(candidates[i], c)) > norm(sub(candidates[first], c))) first = i
  }
  const chosen = [candidates[first]]
  const minD = candidates.map((p) => norm(sub(p, candidates[first])))
  while (chosen.length < count) {
    let best = 0
    for (let i = 1; i < candidates.length; i++) if (minD[i] > minD[best]) best = i
    chosen.push(candidates[best])
    for (let i = 0; i < candidates.length; i++) minD[i] = Math.min(minD[i], norm(sub(candidates[i], candidates[best])))
  }
  return chosen
}

function planeStep(model: PartModel, info: FaceInfo, opts: FeatureOptions, kind: "plane" | "line"): FeatureBuild {
  const N = info.normal!
  let margin = opts.tipRadius + 1.5
  let cand = faceCandidates(model, info, margin, opts)
  while (cand.length < 3 && margin > opts.tipRadius * 0.6) {
    margin *= 0.7
    cand = faceCandidates(model, info, margin, opts)
  }
  if (cand.length < (kind === "line" ? 2 : 3)) {
    return { error: `面太窄，放不下 Ø${(opts.tipRadius * 2).toFixed(1)} 测针球（离边至少 ${margin.toFixed(1)} mm）` }
  }
  const id = stepId()
  if (kind === "line") {
    const c = centroid(cand)
    const { vectors } = symmetricEigen3(scatter(cand, c))
    const D = normalize(vectors[2])
    const W = normalize(cross(N, D))
    const along = cand.map((p) => dot(sub(p, c), D))
    const lo = Math.min(...along)
    const hi = Math.max(...along)
    const picked: Vec3[] = []
    for (const f of [0.08, 0.5, 0.92]) {
      const target = lo + (hi - lo) * f
      let best = cand[0]
      let bestScore = Infinity
      for (const p of cand) {
        const score = Math.abs(dot(sub(p, c), D) - target) + 2 * Math.abs(dot(sub(p, c), W))
        if (score < bestScore) {
          bestScore = score
          best = p
        }
      }
      if (!picked.some((q) => norm(sub(q, best)) < 1e-6)) picked.push(best)
    }
    if (picked.length < 2) return { error: "面太短，取不到两个分开的直线测点" }
    return {
      step: {
        id,
        kind: "line",
        name: opts.name,
        points: points(id, picked.map((p) => ({ nominal: p, approach: scale(N, -1) }))),
      },
    }
  }
  const count = opts.count ?? (info.area > 400 ? 5 : 4)
  const chosen = spreadPoints(cand, count)
  return {
    step: {
      id,
      kind: "plane",
      name: opts.name,
      points: points(id, chosen.map((p) => ({ nominal: p, approach: scale(N, -1) }))),
    },
  }
}

function scatter(points: Vec3[], c: Vec3): number[][] {
  const s = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  for (const p of points) {
    const d = [p.x - c.x, p.y - c.y, p.z - c.z]
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) s[i][j] += d[i] * d[j]
  }
  return s
}

function cylinderStep(info: FaceInfo, opts: FeatureOptions): FeatureBuild {
  const r = info.radius!
  const inner = info.inner !== false
  if (inner && r <= opts.tipRadius + 0.2) {
    return { error: `孔径 Ø${(r * 2).toFixed(3)} 太小，测针球 Ø${(opts.tipRadius * 2).toFixed(1)} 进不去` }
  }
  let axis = info.axis!
  const c0 = info.point!
  let lo = info.axialMin!
  let hi = info.axialMax!
  const depth = hi - lo
  let entry: Vec3 | undefined
  if (inner && opts.distance) {
    const mid = add(c0, scale(axis, (lo + hi) / 2))
    const ends = [1, -1].map((s) => {
      const dir = scale(axis, s)
      const hit = opts.distance!.raycast(mid, dir, depth / 2 + 200)
      return { s, open: hit === null || hit > depth / 2 + opts.tipRadius + 1, up: dir.z }
    })
    const open = ends.filter((e) => e.open).sort((a, b) => b.up - a.up)[0]
    if (!open) return { error: "孔两端都封闭（盲孔底朝下或内腔），测针无法进入" }
    if (open.s < 0) {
      axis = scale(axis, -1)
      ;[lo, hi] = [-hi, -lo]
    }
    entry = add(c0, scale(axis, hi + opts.tipRadius + 8))
  } else if (axis.z < 0) {
    axis = scale(axis, -1)
    ;[lo, hi] = [-hi, -lo]
  }
  const center = add(c0, scale(axis, (lo + hi) / 2))
  const { u, v } = orthonormalBasis(axis)
  const full = (info.arcSpan ?? Math.PI * 2) > Math.PI * 1.9
  const count = opts.count ?? (full ? 4 : 3)
  const angles = full
    ? Array.from({ length: count }, (_, i) => (i / count) * Math.PI * 2 + Math.PI / 4)
    : Array.from({ length: count }, (_, i) => {
        const pad = Math.min(0.2, (info.arcSpan ?? 0) * 0.1)
        return (info.arcStart ?? 0) + pad + (((info.arcSpan ?? 0) - 2 * pad) * i) / Math.max(1, count - 1)
      })
  if (!full && (info.arcSpan ?? 0) < Math.PI / 3) return { error: "圆弧太短（< 60°），测出的圆心不可靠" }
  const id = stepId()
  const list = angles.map((a) => {
    const out = add(scale(u, Math.cos(a)), scale(v, Math.sin(a)))
    return { nominal: add(center, scale(out, r)), approach: inner ? out : scale(out, -1) }
  })
  const step: ProgramStep = {
    id,
    kind: "circle",
    name: opts.name,
    inner,
    axis,
    nominalCenter: center,
    nominalRadius: r,
    points: points(id, list),
    ...(inner ? { maxRetract: Math.max(0.3, r - opts.tipRadius - 0.3) } : {}),
    ...(entry ? { entry } : {}),
  }
  return {
    step,
    note: `${inner ? "孔" : "轴"} Ø${(r * 2).toFixed(3)}，深 ${depth.toFixed(1)} mm${full ? "" : `，圆弧 ${(((info.arcSpan ?? 0) * 180) / Math.PI).toFixed(0)}°`}`,
  }
}

function sphereStep(info: FaceInfo, opts: FeatureOptions): FeatureBuild {
  const c = info.point!
  const r = info.radius!
  const id = stepId()
  const list = [{ nominal: add(c, { x: 0, y: 0, z: r }), approach: { x: 0, y: 0, z: -1 } }]
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4
    const out = normalize({ x: Math.cos(a), y: Math.sin(a), z: 0.8 })
    list.push({ nominal: add(c, scale(out, r)), approach: scale(out, -1) })
  }
  return {
    step: { id, kind: "sphere", name: opts.name, nominalCenter: c, nominalRadius: r, points: points(id, list) },
  }
}

/** 点选一个面后自动生成特征与测点：平面撒点、孔/轴按圆周均布、球面取极点+纬线。 */
export function featureFromFace(
  model: PartModel,
  info: FaceInfo,
  opts: FeatureOptions,
  as?: FeatureKind
): FeatureBuild {
  if (info.kind === "plane") return planeStep(model, info, opts, as === "line" ? "line" : "plane")
  if (info.kind === "cylinder") return cylinderStep(info, opts)
  if (info.kind === "sphere") return sphereStep(info, opts)
  return { error: "这个面不是平面/圆柱/球面，请用「单点」模式逐点选取" }
}

export function singlePointStep(point: Vec3, normal: Vec3, name: string): ProgramStep {
  const id = stepId()
  return { id, kind: "point", name, points: points(id, [{ nominal: point, approach: scale(normalize(normal), -1) }]) }
}

/** 手动逐点添加后，按点和法向补全圆/球的名义参数，供 DMIS 导出与位置度评价。 */
export function completeManualStep(step: ProgramStep): ProgramStep {
  if (step.kind === "circle" && step.points.length >= 3) {
    const n = step.points.map((p) => p.approach)
    let axis = cross(n[0], n[1])
    if (norm(axis) < 1e-6 && n.length > 2) axis = cross(n[0], n[2])
    if (norm(axis) < 1e-6) return step
    axis = normalize(axis)
    if (axis.z < 0) axis = scale(axis, -1)
    const fit = fitCircle(
      step.points.map((p) => p.nominal),
      axis
    )
    const inner = dot(step.points[0].approach, sub(step.points[0].nominal, fit.center)) > 0
    return { ...step, axis: fit.normal, nominalCenter: fit.center, nominalRadius: fit.radius, inner }
  }
  if (step.kind === "sphere" && step.points.length >= 4) {
    const fit = fitSphere(step.points.map((p) => p.nominal))
    return { ...step, nominalCenter: fit.center, nominalRadius: fit.radius }
  }
  return step
}

export const FACE_KIND_LABEL: Record<FaceInfo["kind"], string> = {
  plane: "平面",
  cylinder: "圆柱面",
  sphere: "球面",
  other: "曲面",
}
