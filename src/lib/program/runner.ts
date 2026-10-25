import type { Vec3 } from "@/lib/geom"
import { add, normalize, scale } from "@/lib/math/linalg"
import { applyDir, applyPoint, type RigidTransform } from "@/lib/math/transform"
import { MotionError } from "@/lib/motion/types"
import type { MeasurementProgram, ProbeHit, ProgramStep, StepHits } from "@/lib/program/types"

export type ProbeDriver = {
  position(): Vec3
  moveTo(target: Vec3, speed: number): Promise<void>
  /** expected 是名义模型上到接触点的距离，只有空跑规划用它。 */
  probe(direction: Vec3, maxTravel: number, speed: number, expected?: number): Promise<Vec3 | null>
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

export type TouchTarget = { id: string; surface: Vec3; approach: Vec3; retract?: number }

/** 垂直下刀被挡时，依次尝试沿表面法向外移这么远再下刀、横向进给到预触点。 */
const SIDE_STEP_MM = [10, 25, 45]

type Segment = { from: Vec3; to: Vec3; speed: "rapid" | "measure" }

/**
 * 依次触测一组表面点（机床坐标）。
 * 同一孔内的点直接平移；有进入点时先到孔口外再沿轴线进入，测完原路退出；
 * 其余点从安全平面下刀，被挡就沿法向外移再横向进给。每段运动都先做碰撞预检。
 */
export async function touchSequence(
  driver: ProbeDriver,
  targets: TouchTarget[],
  opts: RunOptions,
  sameCavity: boolean,
  stepId = "",
  entry?: Vec3
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

  const speedOf = (s: Segment["speed"]) => (s === "rapid" ? opts.rapidSpeed : opts.measureSpeed)

  const routeTo = (pre: Vec3, outward: Vec3): Segment[] => {
    const cur = driver.position()
    const lift: Segment[] =
      cur.z < opts.clearanceZ - 1e-6 ? [{ from: cur, to: { ...cur, z: opts.clearanceZ }, speed: "rapid" }] : []
    const top = lift.length ? lift[0].to : cur
    const candidates: Vec3[][] = entry ? [[entry]] : [[], ...SIDE_STEP_MM.map((k) => [add(pre, scale(outward, k))])]
    let firstIssue: string | null = null
    for (const via of candidates) {
      const first = via[0] ?? pre
      const path: Segment[] = [...lift, { from: top, to: { x: first.x, y: first.y, z: opts.clearanceZ }, speed: "rapid" }]
      let at = path[path.length - 1].to
      for (const p of [...via, pre]) {
        path.push({ from: at, to: p, speed: "measure" })
        at = p
      }
      const issue = path.map((s) => opts.checkPath?.(s.from, s.to) ?? null).find(Boolean) ?? null
      if (!issue) return path
      firstIssue ??= issue
    }
    throw new MotionError(firstIssue ?? "找不到无干涉的进给路线", "collision")
  }

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]
    const approach = normalize(t.approach)
    const back = Math.min(opts.retract, t.retract ?? Infinity)
    const pre = add(t.surface, scale(approach, -(opts.tipRadius + back)))
    if (i > 0 && sameCavity) await go(pre, opts.measureSpeed)
    else {
      for (const seg of routeTo(pre, scale(approach, -1))) {
        await opts.beforeMove?.()
        await driver.moveTo(seg.to, speedOf(seg.speed))
      }
    }
    await opts.beforeMove?.()
    const center = await driver.probe(approach, Math.max(opts.searchTravel, back + 2), opts.probeSpeed, back)
    if (center) {
      const hit = { pointId: t.id, center, approach }
      hits.push(hit)
      opts.onHit?.(stepId, hit)
    } else missed.push(t.id)
    // 沿触测方向原路回退，起点贴着表面，不做碰撞预检
    await go(pre, opts.measureSpeed, false)
  }
  if (entry) await go(entry, opts.measureSpeed)
  return { hits, missed }
}

export function stepTargets(step: ProgramStep, placement: RigidTransform): TouchTarget[] {
  return step.points.map((p) => ({
    id: p.id,
    surface: applyPoint(placement, p.nominal),
    approach: applyDir(placement, p.approach),
    ...(step.maxRetract !== undefined ? { retract: step.maxRetract } : {}),
  }))
}

function stepEntry(step: ProgramStep, placement: RigidTransform): Vec3 | undefined {
  return step.entry ? applyPoint(placement, step.entry) : undefined
}

const inCavity = (step: ProgramStep) => step.kind === "circle" && step.inner !== false

export async function executeProgram(
  program: MeasurementProgram,
  driver: ProbeDriver,
  opts: RunOptions
): Promise<StepHits[]> {
  const out: StepHits[] = []
  for (const step of program.steps) {
    opts.onStep?.(step.id)
    const { hits, missed } = await touchSequence(
      driver,
      stepTargets(step, opts.placement),
      opts,
      inCavity(step),
      step.id,
      stepEntry(step, opts.placement)
    )
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

export type PlannedMove = { from: Vec3; to: Vec3; kind: "rapid" | "approach" | "touch"; stepId: string }
export type PlanIssue = { stepId: string; message: string }
export type ProgramPlan = { moves: PlannedMove[]; issues: PlanIssue[]; lengthMm: number; seconds: number }

/**
 * 空跑：用同一套路线规则对名义模型规划全程，不动机床。
 * 输出整条轨迹（快移 / 测量进给 / 触测）、预计时间，以及到不了的特征。
 */
export async function planProgram(program: MeasurementProgram, start: Vec3, opts: RunOptions): Promise<ProgramPlan> {
  let pos = { ...start }
  let stepId = ""
  const moves: PlannedMove[] = []
  const issues: PlanIssue[] = []
  let seconds = 0
  const record = (to: Vec3, kind: PlannedMove["kind"], speed: number) => {
    const len = Math.hypot(to.x - pos.x, to.y - pos.y, to.z - pos.z)
    if (len > 1e-6) {
      moves.push({ from: pos, to: { ...to }, kind, stepId })
      seconds += len / Math.max(speed, 1e-3)
    }
    pos = { ...to }
  }
  const dry: ProbeDriver = {
    position: () => pos,
    moveTo: async (to, speed) => record(to, speed >= opts.rapidSpeed ? "rapid" : "approach", speed),
    probe: async (dir, maxTravel, speed, expected) => {
      const contact = add(pos, scale(dir, Math.min(maxTravel, expected ?? opts.retract)))
      record(contact, "touch", speed)
      return contact
    },
  }
  for (const step of program.steps) {
    stepId = step.id
    try {
      await touchSequence(dry, stepTargets(step, opts.placement), opts, inCavity(step), step.id, stepEntry(step, opts.placement))
    } catch (error) {
      issues.push({ stepId: step.id, message: error instanceof Error ? error.message : "规划失败" })
      if (pos.z < opts.clearanceZ) pos = { ...pos, z: opts.clearanceZ }
    }
  }
  if (pos.z < opts.clearanceZ) record({ ...pos, z: opts.clearanceZ }, "rapid", opts.rapidSpeed)
  const lengthMm = moves.reduce((acc, m) => acc + Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y, m.to.z - m.from.z), 0)
  return { moves, issues, lengthMm, seconds }
}
