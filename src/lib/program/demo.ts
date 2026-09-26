import type { Vec3 } from "@/lib/geom"
import { PLATE } from "@/lib/machine/setup"
import type { GdtCheck, GdtType, MeasurementProgram, ProgramStep } from "@/lib/program/types"

/** 侧面触测高度：上表面以下 8 mm。 */
const SIDE_Z = -8
const HOLE_TOP_Z = -4
const HOLE_BOTTOM_Z = -16

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

export function createDemoProgram(): MeasurementProgram {
  const top: ProgramStep = {
    id: "feat-top",
    kind: "plane",
    name: "上表面",
    points: [
      { x: 15, y: 15 },
      { x: 185, y: 15 },
      { x: 185, y: 125 },
      { x: 15, y: 125 },
      { x: 100, y: 70 },
    ].map((p, i) => ({
      id: `feat-top-pt-${i}`,
      nominal: { x: p.x, y: p.y, z: 0 },
      approach: { x: 0, y: 0, z: -1 },
    })),
  }
  const front: ProgramStep = {
    id: "feat-front",
    kind: "line",
    name: "前侧基准边",
    points: [25, 100, 175].map((x, i) => ({
      id: `feat-front-pt-${i}`,
      nominal: { x, y: 0, z: SIDE_Z },
      approach: { x: 0, y: 1, z: 0 },
    })),
  }
  const left: ProgramStep = {
    id: "feat-left",
    kind: "point",
    name: "左侧基准点",
    points: [{ id: "feat-left-pt-0", nominal: { x: 0, y: 70, z: SIDE_Z }, approach: { x: 1, y: 0, z: 0 } }],
  }
  const holes = PLATE.holes.map((h) =>
    circleStep(`feat-hole-${h.id}`, h.name, { x: h.x, y: h.y, z: HOLE_TOP_Z }, h.r)
  )
  const holeALower = circleStep(
    "feat-hole-A-lower",
    "孔A下沿",
    { x: PLATE.holes[0].x, y: PLATE.holes[0].y, z: HOLE_BOTTOM_Z },
    PLATE.holes[0].r
  )

  const gdt: GdtCheck[] = [
    { id: "gdt-flat", type: "flatness", name: "上表面平面度", featureIds: [top.id], tolerance: 0.01 },
    { id: "gdt-straight", type: "straightness", name: "前侧基准边直线度", featureIds: [front.id], tolerance: 0.01 },
    { id: "gdt-circ-a", type: "circularity", name: "孔A圆度", featureIds: [holes[0].id], tolerance: 0.008 },
    ...holes.map((step) => ({
      id: `gdt-pos-${step.id}`,
      type: "position" as const,
      name: `${step.name}位置度`,
      featureIds: [step.id],
      tolerance: 0.03,
    })),
    {
      id: "gdt-coax-a",
      type: "coaxiality",
      name: "孔A上下同轴度",
      featureIds: [holeALower.id],
      datumIds: [holes[0].id],
      tolerance: 0.02,
    },
  ]

  return {
    id: "demo-bp01",
    name: `${PLATE.name} 预检程序`,
    steps: [top, front, left, ...holes, holeALower],
    gdt,
    alignment: { primary: top.id, secondary: front.id, origin: left.id },
  }
}

/** 加工前：只找基准，用来出装夹偏差和工件坐标系。 */
export function createPresetProgram(): MeasurementProgram {
  const full = createDemoProgram()
  const keep = new Set(["feat-top", "feat-front", "feat-left"])
  return {
    ...full,
    id: "preset-bp01",
    name: `${PLATE.name} 预调`,
    steps: full.steps.filter((step) => keep.has(step.id)),
    gdt: full.gdt.filter(
      (check) =>
        check.featureIds.every((id) => keep.has(id)) && (check.datumIds ?? []).every((id) => keep.has(id))
    ),
  }
}

/** 加工后回机：在同一套基准上复测孔径、位置和形位公差。尺寸按 20 °C 图纸。 */
export function createPostProgram(): MeasurementProgram {
  const full = createDemoProgram()
  return {
    ...full,
    id: "post-bp01",
    name: `${PLATE.name} 加工后复测`,
    steps: full.steps.map((step) =>
      step.kind === "circle" && step.nominalRadius !== undefined ? { ...step, sizeTolerance: 0.03 } : step
    ),
  }
}

export const GDT_LABEL: Record<GdtType, string> = {
  flatness: "平面度",
  straightness: "直线度",
  circularity: "圆度",
  position: "位置度",
  coaxiality: "同轴度",
  parallelism: "平行度",
  perpendicularity: "垂直度",
}

export const KIND_LABEL = { point: "点", line: "直线", plane: "平面", circle: "圆", sphere: "球" } as const
