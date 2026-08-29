import { PLATE } from "@/lib/geom"
import type { GdtCheck, MeasurementProgram, ProgramStep } from "@/lib/program/types"

function planePoints(): ProgramStep {
  const inset = 18
  const z = PLATE.z + PLATE.h
  const corners = [
    { x: PLATE.x + inset, y: PLATE.y + inset, z },
    { x: PLATE.x + PLATE.w - inset, y: PLATE.y + inset, z },
    { x: PLATE.x + PLATE.w - inset, y: PLATE.y + PLATE.d - inset, z },
    { x: PLATE.x + inset, y: PLATE.y + PLATE.d - inset, z },
    { x: PLATE.x + PLATE.w / 2, y: PLATE.y + PLATE.d / 2, z },
  ]
  return {
    id: "feat-plane",
    kind: "plane",
    name: "上平面",
    points: corners.map((nominal, index) => ({ id: `feat-plane-pt-${index}`, nominal })),
  }
}

function circlePoints(id: string, name: string, cx: number, cy: number, cz: number, r: number): ProgramStep {
  const angles = [0, 90, 180, 270]
  return {
    id,
    kind: "circle",
    name,
    nominalCenter: { x: cx, y: cy, z: cz },
    nominalRadius: r,
    points: angles.map((deg) => {
      const rad = (deg * Math.PI) / 180
      return {
        id: `${id}-pt-${deg}`,
        nominal: {
          x: cx + r * Math.cos(rad),
          y: cy + r * Math.sin(rad),
          z: cz,
        },
      }
    }),
  }
}

export function createDemoProgram(): MeasurementProgram {
  const plane = planePoints()
  const holes = PLATE.holes.map((hole) =>
    circlePoints(`feat-hole-${hole.id}`, hole.name, hole.x, hole.y, hole.z, hole.r)
  )
  const holeALower = circlePoints(
    "feat-hole-A-lower",
    "孔A下沿",
    PLATE.holes[0].x,
    PLATE.holes[0].y,
    PLATE.z,
    PLATE.holes[0].r
  )
  const steps = [plane, ...holes, holeALower]
  const gdt: GdtCheck[] = [
    { id: "gdt-flat", type: "flatness", name: "上平面平面度", featureIds: [plane.id], tolerance: 0.02 },
    { id: "gdt-circ-a", type: "circularity", name: "孔A圆度", featureIds: [holes[0].id], tolerance: 0.015 },
    ...holes.map((step, index) => ({
      id: `gdt-pos-${PLATE.holes[index].id}`,
      type: "position" as const,
      name: `${step.name}位置度`,
      featureIds: [step.id],
      tolerance: 0.05,
    })),
    {
      id: "gdt-coax-a",
      type: "coaxiality",
      name: "孔A上下同轴度",
      featureIds: [holes[0].id, holeALower.id],
      tolerance: 0.03,
    },
  ]
  return {
    id: "demo-plate",
    name: "平板四孔示例",
    steps,
    gdt,
  }
}

export const GDT_LABEL: Record<GdtCheck["type"], string> = {
  flatness: "平面度",
  circularity: "圆度",
  position: "位置度",
  coaxiality: "同轴度",
}
