import type { Vec3 } from "@/lib/geom"
import type { GdtCheck, InspectMode, MeasurementProgram, ProgramStep } from "@/lib/program/types"

export function circleStep(
  id: string,
  name: string,
  center: Vec3,
  radius: number,
  inner = true,
  count = 4,
  sizeTolerance?: number
): ProgramStep {
  return {
    id,
    kind: "circle",
    name,
    inner,
    axis: { x: 0, y: 0, z: 1 },
    nominalCenter: center,
    nominalRadius: radius,
    sizeTolerance,
    points: Array.from({ length: count }, (_, i) => {
      const a = (i / count) * Math.PI * 2 + Math.PI / 4
      const out = { x: Math.cos(a), y: Math.sin(a), z: 0 }
      return {
        id: `${id}-pt-${i}`,
        nominal: { x: center.x + radius * out.x, y: center.y + radius * out.y, z: center.z },
        approach: inner ? out : { x: -out.x, y: -out.y, z: 0 },
      }
    }),
  }
}

/** 自动编程的输入：零件外形与孔（零件坐标，原点在前左上角，Z 向下为负）。 */
export type PartModel = {
  id: string
  name: string
  w: number
  d: number
  h: number
  holes: { id: string; name: string; x: number; y: number; r: number }[]
}

/**
 * 布点规则（与现场习惯一致，改规则只改这里）：
 * - 上表面：距边 15 mm 的四角 + 中心，测头沿 -Z 逼近。
 * - 前侧基准边：长度 1/8、1/2、7/8 三点，测头从 -Y 侧沿 +Y 逼近，高度在上表面下 0.4h（不超过 8 mm）。
 * - 左侧原点：Y 方向中点一点，从 -X 侧沿 +X 逼近。
 * - 孔：上口下 0.2h（不超过 4 mm）一圈 4 点；复测时再在孔下沿测一圈，评同轴度。
 * - 顺序：先基准（面 → 边 → 点），再从原点出发按最近邻走孔，同一孔的上下两圈连在一起。
 */
export const AUTO_RULES = {
  planeInset: 15,
  sideDepthRatio: 0.4,
  sideDepthMax: 8,
  holeTopRatio: 0.2,
  holeTopMax: 4,
  holeBottomFromFloor: 4,
  holePoints: 4,
  flatness: 0.01,
  straightness: 0.01,
  circularity: 0.008,
  position: 0.03,
  coaxiality: 0.02,
  sizeTolerance: 0.03,
}

function orderHoles(part: PartModel): PartModel["holes"] {
  const left = [...part.holes]
  const out: PartModel["holes"] = []
  let at = { x: 0, y: part.d / 2 }
  while (left.length) {
    let best = 0
    for (let i = 1; i < left.length; i++) {
      if (Math.hypot(left[i].x - at.x, left[i].y - at.y) < Math.hypot(left[best].x - at.x, left[best].y - at.y)) best = i
    }
    const [next] = left.splice(best, 1)
    out.push(next)
    at = next
  }
  return out
}

export function autoProgram(
  part: PartModel,
  mode: InspectMode,
  options: { sizeTolerance?: number | null; name?: string } = {}
): MeasurementProgram {
  const r = AUTO_RULES
  const sideZ = -Math.min(r.sideDepthMax, part.h * r.sideDepthRatio)
  const inset = Math.min(r.planeInset, part.w / 4, part.d / 4)
  const top: ProgramStep = {
    id: "feat-top",
    kind: "plane",
    name: "上表面",
    points: [
      { x: inset, y: inset },
      { x: part.w - inset, y: inset },
      { x: part.w - inset, y: part.d - inset },
      { x: inset, y: part.d - inset },
      { x: part.w / 2, y: part.d / 2 },
    ].map((p, i) => ({ id: `feat-top-pt-${i}`, nominal: { x: p.x, y: p.y, z: 0 }, approach: { x: 0, y: 0, z: -1 } })),
  }
  const front: ProgramStep = {
    id: "feat-front",
    kind: "line",
    name: "前侧基准边",
    points: [0.125, 0.5, 0.875].map((t, i) => ({
      id: `feat-front-pt-${i}`,
      nominal: { x: part.w * t, y: 0, z: sideZ },
      approach: { x: 0, y: 1, z: 0 },
    })),
  }
  const left: ProgramStep = {
    id: "feat-left",
    kind: "point",
    name: "左侧基准点",
    points: [{ id: "feat-left-pt-0", nominal: { x: 0, y: part.d / 2, z: sideZ }, approach: { x: 1, y: 0, z: 0 } }],
  }
  const datums = [top, front, left]
  const gdt: GdtCheck[] = [
    { id: "gdt-flat", type: "flatness", name: "上表面平面度", featureIds: [top.id], tolerance: r.flatness },
    { id: "gdt-straight", type: "straightness", name: "前侧基准边直线度", featureIds: [front.id], tolerance: r.straightness },
  ]
  const alignment = { primary: top.id, secondary: front.id, origin: left.id }

  if (mode === "preset") {
    return {
      id: `preset-${part.id}`,
      name: options.name ?? `${part.name} 预调`,
      steps: datums,
      gdt,
      alignment,
    }
  }

  const sizeTolerance = options.sizeTolerance === null ? undefined : (options.sizeTolerance ?? r.sizeTolerance)
  const topZ = -Math.min(r.holeTopMax, part.h * r.holeTopRatio)
  const bottomZ = -(part.h - r.holeBottomFromFloor)
  const steps: ProgramStep[] = [...datums]
  orderHoles(part).forEach((h, index) => {
    const center: Vec3 = { x: h.x, y: h.y, z: topZ }
    const step = circleStep(`feat-hole-${h.id}`, h.name, center, h.r, true, r.holePoints, sizeTolerance)
    steps.push(step)
    gdt.push({ id: `gdt-pos-${step.id}`, type: "position", name: `${h.name}位置度`, featureIds: [step.id], tolerance: r.position })
    gdt.push({ id: `gdt-circ-${step.id}`, type: "circularity", name: `${h.name}圆度`, featureIds: [step.id], tolerance: r.circularity })
    if (index === 0 && bottomZ < topZ - 2) {
      const lower = circleStep(
        `feat-hole-${h.id}-lower`,
        `${h.name}下沿`,
        { ...center, z: bottomZ },
        h.r,
        true,
        r.holePoints,
        sizeTolerance
      )
      steps.push(lower)
      gdt.push({
        id: `gdt-coax-${h.id}`,
        type: "coaxiality",
        name: `${h.name}上下同轴度`,
        featureIds: [lower.id],
        datumIds: [step.id],
        tolerance: r.coaxiality,
      })
    }
  })

  return {
    id: `post-${part.id}`,
    name: options.name ?? `${part.name} 加工后复测`,
    steps,
    gdt,
    alignment,
  }
}
