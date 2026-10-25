import type { Vec3 } from "@/lib/geom"
import { add, cross, dot, mat3Mul, norm, scale, sub } from "@/lib/math/linalg"
import { applyDir, applyPoint, type RigidTransform } from "@/lib/math/transform"

export type FitPair = {
  /** 名义表面点与外法向（零件坐标）。 */
  nominal: Vec3
  normal: Vec3
  /** 补偿后的实测表面点（机床坐标）。 */
  measured: Vec3
}

export type BestFitResult =
  | { ok: true; partToMachine: RigidTransform; rms: number; maxAbs: number }
  | { ok: false; reason: string }

function rodrigues(w: Vec3): RigidTransform["r"] {
  const th = norm(w)
  if (th < 1e-15) return [1, 0, 0, 0, 1, 0, 0, 0, 1]
  const k = scale(w, 1 / th)
  const c = Math.cos(th)
  const s = Math.sin(th)
  const v = 1 - c
  return [
    c + k.x * k.x * v,
    k.x * k.y * v - k.z * s,
    k.x * k.z * v + k.y * s,
    k.y * k.x * v + k.z * s,
    c + k.y * k.y * v,
    k.y * k.z * v - k.x * s,
    k.z * k.x * v - k.y * s,
    k.z * k.y * v + k.x * s,
    c + k.z * k.z * v,
  ]
}

/** 6×6 Cholesky，主元过小说明测点方向不足以约束全部自由度。 */
function choleskySolve(A: number[][], b: number[]): number[] | null {
  const n = b.length
  const L = A.map(() => new Array<number>(n).fill(0))
  const scaleRef = Math.max(...A.map((row, i) => row[i]), 1e-30)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i][j]
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k]
      if (i === j) {
        if (s <= scaleRef * 1e-9) return null
        L[i][i] = Math.sqrt(s)
      } else L[i][j] = s / L[j][j]
    }
  }
  const y = new Array<number>(n).fill(0)
  for (let i = 0; i < n; i++) {
    let s = b[i]
    for (let k = 0; k < i; k++) s -= L[i][k] * y[k]
    y[i] = s / L[i][i]
  }
  const x = new Array<number>(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i]
    for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k]
    x[i] = s / L[i][i]
  }
  return x
}

/**
 * 点到面最佳拟合找正：求零件→机床刚体变换，使每个实测点到其名义切平面的距离平方和最小。
 * 测点法向要覆盖三个方向（例如顶面 + 两个侧面或孔），否则自由度约束不住会直接报错。
 */
export function bestFitAlignment(pairs: FitPair[], initial: RigidTransform, iterations = 12): BestFitResult {
  if (pairs.length < 6) return { ok: false, reason: `最佳拟合至少要 6 个测点，现在 ${pairs.length} 个` }
  let T: RigidTransform = { r: [...initial.r] as RigidTransform["r"], t: { ...initial.t } }
  for (let iter = 0; iter < iterations; iter++) {
    const pts = pairs.map((p) => applyPoint(T, p.nominal))
    const c = scale(
      pts.reduce((acc, p) => add(acc, p), { x: 0, y: 0, z: 0 }),
      1 / pts.length
    )
    const JtJ = Array.from({ length: 6 }, () => new Array<number>(6).fill(0))
    const Jtr = new Array<number>(6).fill(0)
    pairs.forEach((pair, i) => {
      const n = applyDir(T, pair.normal)
      const pc = sub(pts[i], c)
      const r = dot(n, sub(pair.measured, pts[i]))
      const rot = cross(pc, n)
      const J = [rot.x, rot.y, rot.z, n.x, n.y, n.z]
      for (let a = 0; a < 6; a++) {
        Jtr[a] += J[a] * r
        for (let b = 0; b < 6; b++) JtJ[a][b] += J[a] * J[b]
      }
    })
    const step = choleskySolve(JtJ, Jtr)
    if (!step) {
      return { ok: false, reason: "测点法向不够分散，约束不住 6 个自由度（需要顶面之外再测侧面或孔）" }
    }
    const w = { x: step[0], y: step[1], z: step[2] }
    const dt = { x: step[3], y: step[4], z: step[5] }
    const R = rodrigues(w)
    const rc = applyDir({ r: R, t: { x: 0, y: 0, z: 0 } }, sub(T.t, c))
    T = { r: mat3Mul(R, T.r), t: add(add(c, rc), dt) }
    if (norm(w) < 1e-12 && norm(dt) < 1e-10) break
  }
  const res = pairs.map((p) => dot(applyDir(T, p.normal), sub(p.measured, applyPoint(T, p.nominal))))
  const rms = Math.sqrt(res.reduce((a, r) => a + r * r, 0) / res.length)
  return { ok: true, partToMachine: T, rms, maxAbs: Math.max(...res.map(Math.abs)) }
}
