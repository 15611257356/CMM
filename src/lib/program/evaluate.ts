import type { Vec3 } from "@/lib/geom"
import { align321 } from "@/lib/coords/alignment"
import { palletOffset } from "@/lib/coords/work-offset"
import { fitCircle, fitLine, fitPlane, fitSphere, probeCompensation } from "@/lib/measure/fit"
import { coaxiality, parallelism, perpendicularity, positionDiameter } from "@/lib/measure/gdt"
import { add, normalize, scale, sub } from "@/lib/math/linalg"
import { applyDir, applyPoint, invert, type RigidTransform } from "@/lib/math/transform"
import type {
  Evaluation,
  FeatureResult,
  GdtResult,
  MeasurementProgram,
  ProgramStep,
  StepHits,
} from "@/lib/program/types"

export type EvalContext = {
  tipRadius: number
  palletToMachine: RigidTransform
  nominalPartToPallet: RigidTransform
  /** 名义装夹（零件 → 机床），未建立零件坐标系时按它评价。 */
  placement: RigidTransform
}

const MIN_POINTS = { point: 1, line: 2, plane: 3, circle: 3, sphere: 4 } as const

function evaluateStep(step: ProgramStep, entry: StepHits | undefined, ctx: EvalContext): FeatureResult {
  const base: FeatureResult = { stepId: step.id, name: step.name, kind: step.kind, ok: false, surfacePoints: [] }
  const hits = entry?.hits ?? []
  if (hits.length < MIN_POINTS[step.kind]) {
    return { ...base, error: entry?.error ?? "测点不足" }
  }
  const r = ctx.tipRadius
  const centers = hits.map((h) => h.center)
  const meanApproach = () =>
    normalize(hits.reduce((acc, h) => add(acc, h.approach), { x: 0, y: 0, z: 0 } as Vec3))
  const surfacePoints = hits.map((h) => probeCompensation.point(h.center, h.approach, r))
  try {
    switch (step.kind) {
      case "point":
        return { ...base, ok: true, point: surfacePoints[0], surfacePoints }
      case "plane": {
        const fit = probeCompensation.plane(fitPlane(centers, scale(meanApproach(), -1)), r)
        return { ...base, ok: true, plane: fit, surfacePoints }
      }
      case "line": {
        const p0 = step.points[0].nominal
        const p1 = step.points[step.points.length - 1].nominal
        const dirHint = applyDir(ctx.placement, sub(p1, p0))
        const refNormal = applyDir(ctx.placement, { x: 0, y: 0, z: 1 })
        const fit = probeCompensation.line(fitLine(centers, refNormal, dirHint), meanApproach(), r)
        return { ...base, ok: true, line: fit, surfacePoints }
      }
      case "circle": {
        const axis = applyDir(ctx.placement, step.axis ?? { x: 0, y: 0, z: 1 })
        const fit = probeCompensation.circle(fitCircle(centers, axis), step.inner !== false, r)
        return { ...base, ok: true, circle: fit, diameter: fit.radius * 2, surfacePoints }
      }
      case "sphere": {
        const fit = probeCompensation.sphere(fitSphere(centers), r)
        return { ...base, ok: true, sphere: fit, diameter: fit.radius * 2, surfacePoints }
      }
    }
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : "拟合失败" }
  }
}

export function evaluateProgram(program: MeasurementProgram, hits: StepHits[], ctx: EvalContext): Evaluation {
  const features = program.steps.map((step) =>
    evaluateStep(
      step,
      hits.find((h) => h.stepId === step.id),
      ctx
    )
  )
  const byId = (id: string) => features.find((f) => f.stepId === id)

  let partToMachine = ctx.placement
  let aligned = false
  let alignmentNote = "程序未定义 3-2-1 找正，按名义装夹评价位置度。"
  if (program.alignment) {
    const primary = byId(program.alignment.primary)?.plane
    const secondary = byId(program.alignment.secondary)?.line
    const origin = byId(program.alignment.origin)?.point
    if (primary && secondary && origin) {
      partToMachine = align321(primary, secondary, origin, {
        zHint: applyDir(ctx.placement, { x: 0, y: 0, z: 1 }),
        xHint: applyDir(ctx.placement, { x: 1, y: 0, z: 0 }),
      })
      aligned = true
      alignmentNote = "已按 3-2-1 建立零件坐标系（上表面 / 前侧边 / 左侧点）。"
    } else {
      alignmentNote = "找正特征测量失败，零件坐标系未建立，位置度按名义装夹评价。"
    }
  }

  const toPart = invert(partToMachine)
  for (const f of features) {
    if (f.circle) f.inPart = applyPoint(toPart, f.circle.center)
    else if (f.point) f.inPart = applyPoint(toPart, f.point)
    else if (f.sphere) f.inPart = applyPoint(toPart, f.sphere.center)
  }

  const gdt: GdtResult[] = program.gdt.map((check) => {
    const feats = check.featureIds.map(byId)
    const datums = (check.datumIds ?? []).map(byId)
    const f0 = feats[0]
    let value = NaN
    switch (check.type) {
      case "flatness":
        value = f0?.plane?.flatness ?? NaN
        break
      case "straightness":
        value = f0?.line?.straightness ?? NaN
        break
      case "circularity":
        value = f0?.circle?.circularity ?? NaN
        break
      case "position": {
        const step = program.steps.find((s) => s.id === check.featureIds[0])
        if (f0?.inPart && step?.nominalCenter) value = positionDiameter(f0.inPart, step.nominalCenter)
        break
      }
      case "coaxiality": {
        const d = datums[0]?.circle
        if (d && f0?.circle) value = coaxiality(d.center, d.normal, f0.circle.center)
        break
      }
      case "parallelism": {
        const d = datums[0]?.plane
        if (d && f0?.surfacePoints.length) value = parallelism(f0.surfacePoints, d.normal)
        break
      }
      case "perpendicularity": {
        const d = datums[0]?.plane
        if (d && f0?.plane) value = perpendicularity(f0.surfacePoints, f0.plane.normal, d.normal)
        break
      }
    }
    return {
      checkId: check.id,
      name: check.name,
      type: check.type,
      value,
      tolerance: check.tolerance,
      passed: Number.isFinite(value) && value <= check.tolerance,
    }
  })

  return {
    features,
    gdt,
    aligned,
    alignmentNote,
    partToMachine,
    pallet: palletOffset(partToMachine, ctx.palletToMachine, ctx.nominalPartToPallet),
    tipRadius: ctx.tipRadius,
  }
}

export type PalletCalibration = {
  palletToMachine: RigidTransform
  tipRadius: number
  sphereForm: number
  /** 标定结果相对设计值的偏差（机床坐标）。 */
  shift: Vec3
  at: string
}

/**
 * 标准球标定：球心确定托盘零点（托盘靠键槽定向，只标平移），
 * 球心轨迹半径减去证书半径得到测针有效半径。
 */
export function calibrateFromSphere(
  centers: Vec3[],
  certifiedRadius: number,
  sphereInPallet: Vec3,
  nominalPalletToMachine: RigidTransform
): PalletCalibration {
  const fit = fitSphere(centers)
  const tipRadius = fit.radius - certifiedRadius
  if (tipRadius <= 0) throw new Error("标定失败：测针有效半径不为正，请检查标准球直径设置")
  const offset = applyDir(nominalPalletToMachine, sphereInPallet)
  const t = sub(fit.center, offset)
  return {
    palletToMachine: { r: nominalPalletToMachine.r, t },
    tipRadius,
    sphereForm: fit.form,
    shift: sub(t, nominalPalletToMachine.t),
    at: new Date().toISOString(),
  }
}

/** 标准球触测点：顶点 + 赤道 4 点 + 45° 纬线 4 点。 */
export function sphereTouchTargets(center: Vec3, radius: number) {
  const targets = [{ id: "sph-top", surface: add(center, { x: 0, y: 0, z: radius }), approach: { x: 0, y: 0, z: -1 } }]
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2
    const out = { x: Math.cos(a), y: Math.sin(a), z: 0 }
    targets.push({ id: `sph-eq-${i}`, surface: add(center, scale(out, radius)), approach: scale(out, -1) })
  }
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4
    const out = normalize({ x: Math.cos(a), y: Math.sin(a), z: 1 })
    targets.push({ id: `sph-45-${i}`, surface: add(center, scale(out, radius)), approach: scale(out, -1) })
  }
  return targets
}