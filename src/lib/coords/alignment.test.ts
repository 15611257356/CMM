import { describe, expect, it } from "vitest"
import { align321, alignPlaneTwoHoles } from "@/lib/coords/alignment"
import { palletOffset, workOffsetFromPose, workOffsetNc } from "@/lib/coords/work-offset"
import { DEFAULT_MACHINE_TOOL } from "@/lib/machine/setup"
import { fitCircle, fitLine, fitPlane } from "@/lib/measure/fit"
import { applyDir, applyPoint, compose, fromPoseDeg, identityTransform, toPoseDeg } from "@/lib/math/transform"

const truth = fromPoseDeg({ x: 151.237, y: 129.155, z: 80.004, rz: 0.2731, ry: 0.0011, rx: -0.0007 })
const P = (x: number, y: number, z: number) => applyPoint(truth, { x, y, z })

describe("3-2-1 找正", () => {
  it("从上表面/前侧边/左侧点精确反算零件坐标系", () => {
    const plane = fitPlane([P(10, 10, 0), P(190, 10, 0), P(190, 130, 0), P(10, 130, 0)], applyDir(truth, { x: 0, y: 0, z: 1 }))
    const line = fitLine([P(20, 0, -8), P(180, 0, -8)], plane.normal, { x: 1, y: 0, z: 0 })
    const T = align321(plane, line, P(0, 70, -8), { zHint: { x: 0, y: 0, z: 1 }, xHint: { x: 1, y: 0, z: 0 } })
    const got = toPoseDeg(T)
    const want = toPoseDeg(truth)
    for (const k of ["x", "y", "z"] as const) expect(got[k]).toBeCloseTo(want[k], 9)
    for (const k of ["rz", "ry", "rx"] as const) expect(got[k]).toBeCloseTo(want[k], 9)
  })

  it("一面两孔找正", () => {
    const plane = fitPlane([P(10, 10, 0), P(190, 10, 0), P(190, 130, 0), P(10, 130, 0)], { x: 0, y: 0, z: 1 })
    const circle = (cx: number, cy: number) =>
      fitCircle(
        [0, 90, 180, 270].map((d) => P(cx + 8 * Math.cos((d * Math.PI) / 180), cy + 8 * Math.sin((d * Math.PI) / 180), -4)),
        { x: 0, y: 0, z: 1 }
      )
    const T = alignPlaneTwoHoles(plane, circle(40, 30), circle(160, 110), {
      zHint: { x: 0, y: 0, z: 1 },
      nominalHole1: { x: 40, y: 30, z: 0 },
      nominalAngle: Math.atan2(80, 120),
    })
    const got = toPoseDeg(T)
    const want = toPoseDeg(truth)
    expect(got.x).toBeCloseTo(want.x, 7)
    expect(got.y).toBeCloseTo(want.y, 7)
    expect(got.rz).toBeCloseTo(want.rz, 7)
  })
})

describe("零点托盘偏差与 G54", () => {
  it("偏差、G54 数值和 G10 代码", () => {
    const pallet = fromPoseDeg({ x: 250, y: 200, z: 60, rz: 0, ry: 0, rx: 0 })
    const nominal = fromPoseDeg({ x: -100, y: -70, z: 20, rz: 0, ry: 0, rx: 0 })
    const actualOnPallet = fromPoseDeg({ x: -98.8, y: -70.6, z: 20.01, rz: 0.25, ry: 0, rx: 0 })
    const res = palletOffset(compose(pallet, actualOnPallet), pallet, nominal)
    expect(res.delta.x).toBeCloseTo(1.2, 9)
    expect(res.delta.y).toBeCloseTo(-0.6, 9)
    expect(res.delta.z).toBeCloseTo(0.01, 9)
    expect(res.delta.rz).toBeCloseTo(0.25, 9)
    expect(res.tiltWarning).toBeNull()

    const wo = workOffsetFromPose(res.actual, DEFAULT_MACHINE_TOOL)
    expect(wo.x).toBeCloseTo(-412.5 - 98.8, 9)
    expect(wo.z).toBeCloseTo(-385.2 + 20.01, 9)
    const nc = workOffsetNc(wo, true)
    expect(nc).toContain("G10 L2 P1 X-511.3000 Y-307.4000 Z-365.1900")
    expect(nc).toContain("G68 X0 Y0 R0.25000")
  })

  it("倾斜超限给出提示", () => {
    const tilted = fromPoseDeg({ x: 0, y: 0, z: 0, rz: 0, ry: 0.05, rx: 0 })
    expect(palletOffset(tilted, identityTransform(), identityTransform()).tiltWarning).toMatch(/倾斜/)
  })
})
