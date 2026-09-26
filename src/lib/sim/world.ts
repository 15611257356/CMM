import type { Vec3 } from "@/lib/geom"
import { PALLET, PLATE } from "@/lib/machine/setup"
import { add, scale } from "@/lib/math/linalg"
import { applyPoint, compose, fromPoseDeg, invert, type PoseDeg, type RigidTransform } from "@/lib/math/transform"

/**
 * 仿真世界：用有向距离场描述大理石台面、零点托盘、标准球和零件，
 * 仿真测头沿触测方向做球面追踪，算出红宝石球真正碰到表面时的球心。
 * 这里的「真实」位姿软件本身并不知道，只能靠测量求出来。
 */

export type SimHole = { x: number; y: number; r: number }

export type SimTruth = {
  palletToMachine: RigidTransform
  partToPallet: RigidTransform
  partPose: PoseDeg
  holes: SimHole[]
  /** 测针有效半径（含预行程），标定前软件不知道。 */
  tipRadius: number
  /** 单点重复性噪声（mm，均匀分布半宽）。 */
  noise: number
}

function boxSdf(p: Vec3, min: Vec3, max: Vec3): number {
  const cx = (min.x + max.x) / 2
  const cy = (min.y + max.y) / 2
  const cz = (min.z + max.z) / 2
  const qx = Math.abs(p.x - cx) - (max.x - min.x) / 2
  const qy = Math.abs(p.y - cy) - (max.y - min.y) / 2
  const qz = Math.abs(p.z - cz) - (max.z - min.z) / 2
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0))
  const inside = Math.min(Math.max(qx, qy, qz), 0)
  return outside + inside
}

export function createTruth(random: () => number = Math.random): SimTruth {
  const r = (span: number) => (random() - 0.5) * 2 * span
  const palletError = fromPoseDeg({ x: 0.0123, y: -0.0083, z: 0.0041, rz: 0, ry: 0, rx: 0 })
  const partPose: PoseDeg = {
    x: -PLATE.w / 2 + r(1.5),
    y: -PLATE.d / 2 + r(1.5),
    z: PLATE.h + r(0.015),
    rz: r(0.35),
    ry: r(0.002),
    rx: r(0.002),
  }
  return {
    palletToMachine: compose(PALLET.nominalToMachine, palletError),
    partToPallet: fromPoseDeg(partPose),
    partPose,
    holes: PLATE.holes.map((h, i) => ({
      x: h.x + [0.004, -0.006, 0.003, -0.002][i],
      y: h.y + [-0.003, 0.002, 0.005, -0.004][i],
      r: h.r + [0.006, 0.009, 0.004, 0.011][i],
    })),
    tipRadius: 1.9987,
    noise: 0.0004,
  }
}

export function truthWithPartPose(truth: SimTruth, partPose: PoseDeg): SimTruth {
  return { ...truth, partPose, partToPallet: fromPoseDeg(partPose) }
}

export function partToMachine(truth: SimTruth): RigidTransform {
  return compose(truth.palletToMachine, truth.partToPallet)
}

export function sceneSdf(truth: SimTruth, p: Vec3): number {
  const table = p.z
  const pl = applyPoint(invert(truth.palletToMachine), p)
  const pallet = boxSdf(
    pl,
    { x: -PALLET.size.x / 2, y: -PALLET.size.y / 2, z: -PALLET.height },
    { x: PALLET.size.x / 2, y: PALLET.size.y / 2, z: 0 }
  )
  const s = PALLET.referenceSphere
  const sphere = Math.hypot(pl.x - s.center.x, pl.y - s.center.y, pl.z - s.center.z) - s.radius
  const stemTop = s.center.z - s.radius * 0.8
  const stem = Math.max(Math.hypot(pl.x - s.center.x, pl.y - s.center.y) - s.stemRadius, pl.z - stemTop, -pl.z)

  const pp = applyPoint(invert(truth.partToPallet), pl)
  let part = boxSdf(pp, { x: 0, y: 0, z: -PLATE.h }, { x: PLATE.w, y: PLATE.d, z: 0 })
  for (const h of truth.holes) part = Math.max(part, h.r - Math.hypot(pp.x - h.x, pp.y - h.y))

  return Math.min(table, pallet, sphere, stem, part)
}

export type TouchResult = { kind: "hit"; center: Vec3 } | { kind: "miss" } | { kind: "collision" }

/** 从 start 沿单位方向 dir 触测，最远 maxTravel。返回锁存的球心坐标。 */
export function simulateTouch(
  truth: SimTruth,
  start: Vec3,
  dir: Vec3,
  maxTravel: number,
  random: () => number = Math.random
): TouchResult {
  const r = truth.tipRadius
  if (sceneSdf(truth, start) - r <= 0) return { kind: "collision" }
  let t = 0
  for (let i = 0; i < 400; i++) {
    const p = add(start, scale(dir, t))
    const d = sceneSdf(truth, p) - r
    if (d < 1e-7) {
      const n = () => (random() - 0.5) * 2 * truth.noise
      return { kind: "hit", center: { x: p.x + n(), y: p.y + n(), z: p.z + n() } }
    }
    t += d
    if (t > maxTravel) return { kind: "miss" }
  }
  return { kind: "miss" }
}

/** 直线运动路径的碰撞预检：沿线每 0.5 mm 检查测针球与场景的间隙。 */
export function segmentClearance(truth: SimTruth, a: Vec3, b: Vec3, margin = 0.3): number {
  const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
  const steps = Math.max(1, Math.ceil(len / 0.5))
  let minGap = Infinity
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }
    minGap = Math.min(minGap, sceneSdf(truth, p) - truth.tipRadius - margin)
  }
  return minGap
}