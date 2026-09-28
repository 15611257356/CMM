import type { Vec3 } from "@/lib/geom"
import { add, normalize, scale } from "@/lib/math/linalg"
import { applyDir, applyPoint, type RigidTransform } from "@/lib/math/transform"
import { MotionError } from "@/lib/motion/types"
import type { MeasurementProgram, ProbeHit, StepHits } from "@/lib/program/types"

export type ProbeDriver = {
  position(): Vec3
  moveTo(target: Vec3, speed: number): Promise<void>
  probe(direction: Vec3, maxTravel: number, speed: number): Promise<Vec3 | null>
}

export type RunOptions = {
  /** 名义装夹：零件坐标 → 机床坐标。 */
  placement: RigidTransform
  /** 安全平面高度（机床 Z）。 */
  clearanceZ: number
  tipRadius: number
  retract: number
  searchTravel: number
  rapidSpeed: number
  measureSpeed: number
  probeSpeed: number
  /** 运动前的碰撞预检，返回非空字符串表示有干涉风险。 */
  checkPath?: (from: Vec3, to: Vec3) => string | null
  beforeMove?: () => Promise<void>
  onStep?: (stepId: string) => void
  onHit?: (stepId: string, hit: ProbeHit) => void
}

export type TouchTarget = { id: string; surface: Vec3; approach: Vec3 }

/**
 * 依次触测一组表面点（机床坐标）。进出同一个孔时直接平移，
 * 其余情况先抬到安全平面，再平移、下降，每段运动都先做碰撞预检。
 */
export async function touchSequence(
  driver: ProbeDriver,
  targets: TouchTarget[],
  opts: RunOptions,
  sameCavity: boolean,
  stepId = ""
): Promise<{ hits: ProbeHit[]; missed: string[] }> {
  const hits: ProbeHit[] = []
  const missed: string[] = []

  const go = async (to: Vec3, speed: number, check = true) => {
    await opts.beforeMove?.()
    const from = driver.position()
    const issue = check ? opts.checkPath?.(from, to) : null
    if (issue) throw new MotionError(issue, "collision")
    await driver.moveTo(to, speed)
  }

  const viaClearance = async (to: Vec3) => {
    const cur = driver.position()
    if (cur.z < opts.clearanceZ - 1e-6) await go({ ...cur, z: opts.clearanceZ }, opts.rapidSpeed)
    await go({ x: to.x, y: to.y, z: opts.clearanceZ }, opts.rapidSpeed)
    await go(to, opts.measureSpeed)
  }

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]
    const approach = normalize(t.approach)
    const pre = add(t.surface, scale(approach, -(opts.tipRadius + opts.retract)))
    if (i > 0 && sameCavity) await go(pre, opts.measureSpeed)
    else await viaClearance(pre)
    await opts.beforeMove?.()
    const center = await driver.probe(approach, opts.searchTravel, opts.probeSpeed)
    if (center) {
      const hit = { pointId: t.id, center, approach }
      hits.push(hit)
      opts.onHit?.(stepId, hit)
    } else missed.push(t.id)
    // 沿触测方向原路回退，起点贴着表面，不做碰撞预检
    await go(pre, opts.measureSpeed, false)
  }
  return { hits, missed }
}

/**
 * 标准球：同一截面四点。每点径向逼近、径向退出，点与点之间绕球心走 90° 圆弧，
 * 四点做完抬到球顶上方，再垂直向下测顶点。
 */
export async function touchSphereSection(
  driver: ProbeDriver,
  center: Vec3,
  radius: number,
  opts: RunOptions,
  arcStepDeg = 10
): Promise<{ hits: ProbeHit[]; missed: string[] }> {
  const hits: ProbeHit[] = []
  const missed: string[] = []
  const standoff = radius + opts.tipRadius + opts.retract
  const onRing = (deg: number): Vec3 => {
    const a = (deg * Math.PI) / 180
    return { x: center.x + standoff * Math.cos(a), y: center.y + standoff * Math.sin(a), z: center.z }
  }

  const go = async (to: Vec3, speed: number, check = true) => {
    await opts.beforeMove?.()
    const from = driver.position()
    const issue = check ? opts.checkPath?.(from, to) : null
    if (issue) throw new MotionError(issue, "collision")
    await driver.moveTo(to, speed)
  }

  const touch = async (id: string, approach: Vec3, back: Vec3) => {
    await opts.beforeMove?.()
    const hit = await driver.probe(approach, opts.searchTravel, opts.probeSpeed)
    if (hit) {
      const record = { pointId: id, center: hit, approach }
      hits.push(record)
      opts.onHit?.("", record)
    } else missed.push(id)
    await go(back, opts.measureSpeed, false)
  }

  const start = onRing(0)
  const cur = driver.position()
  if (cur.z < opts.clearanceZ - 1e-6) await go({ ...cur, z: opts.clearanceZ }, opts.rapidSpeed)
  await go({ x: start.x, y: start.y, z: opts.clearanceZ }, opts.rapidSpeed)
  await go(start, opts.measureSpeed)

  for (let i = 0; i < 4; i++) {
    const deg = i * 90
    if (i > 0) {
      for (let a = deg - 90 + arcStepDeg; a <= deg + 1e-9; a += arcStepDeg) await go(onRing(a), opts.measureSpeed)
    }
    const a = (deg * Math.PI) / 180
    await touch(`sph-sec-${i}`, { x: -Math.cos(a), y: -Math.sin(a), z: 0 }, onRing(deg))
  }

  const last = driver.position()
  const aboveTop = { x: center.x, y: center.y, z: center.z + standoff }
  await go({ ...last, z: aboveTop.z }, opts.measureSpeed)
  await go(aboveTop, opts.measureSpeed)
  await touch("sph-top", { x: 0, y: 0, z: -1 }, aboveTop)
  return { hits, missed }
}

export async function executeProgram(
  program: MeasurementProgram,
  driver: ProbeDriver,
  opts: RunOptions
): Promise<StepHits[]> {
  const out: StepHits[] = []
  for (const step of program.steps) {
    opts.onStep?.(step.id)
    const targets = step.points.map((p) => ({
      id: p.id,
      surface: applyPoint(opts.placement, p.nominal),
      approach: applyDir(opts.placement, p.approach),
    }))
    const inCavity = step.kind === "circle" && step.inner !== false
    const { hits, missed } = await touchSequence(driver, targets, opts, inCavity, step.id)
    out.push({
      stepId: step.id,
      hits,
      error: missed.length ? `${missed.length} 个测点在搜索行程内未触发` : undefined,
    })
  }
  const cur = driver.position()
  if (cur.z < opts.clearanceZ) await driver.moveTo({ ...cur, z: opts.clearanceZ }, opts.rapidSpeed)
  return out
}
