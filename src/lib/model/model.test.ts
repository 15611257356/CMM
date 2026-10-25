import { readFileSync } from "node:fs"
import { join } from "node:path"
import occtimportjs from "occt-import-js"
import { beforeAll, describe, expect, it } from "vitest"
import { PALLET, PROBE, nominalPartToMachine } from "@/lib/machine/setup"
import { applyPoint, compose, toPoseDeg } from "@/lib/math/transform"
import { createModelDistance, type ModelDistance } from "@/lib/model/distance"
import { buildModel } from "@/lib/model/mesh"
import { modelFromOcct, OCCT_PARAMS, type OcctResult } from "@/lib/model/occt"
import { parseStl } from "@/lib/model/parse-mesh"
import { modelBoundsIn, modelOnPallet } from "@/lib/model/placement"
import { analyzeFace, featureFromFace } from "@/lib/model/recognize"
import type { PartModel } from "@/lib/model/types"
import { evaluateProgram } from "@/lib/program/evaluate"
import { executeProgram, planProgram, type ProbeDriver, type RunOptions } from "@/lib/program/runner"
import type { MeasurementProgram, ProgramStep } from "@/lib/program/types"
import { createTruth, segmentClearance, simulateTouch, type SimTruth } from "@/lib/sim/world"

const SAMPLE = join(process.cwd(), "public/samples/locating-block-lb02.step")

function seeded(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

let model: PartModel
let dist: ModelDistance

beforeAll(async () => {
  const occt = await (occtimportjs as unknown as () => Promise<{ ReadStepFile: (b: Uint8Array, p: unknown) => OcctResult }>)()
  const result = occt.ReadStepFile(new Uint8Array(readFileSync(SAMPLE)), OCCT_PARAMS)
  model = modelFromOcct("locating-block-lb02.step", "step", result)
  dist = createModelDistance(model)
})

function faceWhere(pred: (f: ReturnType<typeof analyzeFace>) => boolean) {
  for (let i = 0; i < model.faceCount; i++) {
    const f = analyzeFace(model, i)
    if (pred(f)) return f
  }
  throw new Error("face not found")
}

function build(f: ReturnType<typeof analyzeFace>, name: string, as?: "line"): ProgramStep {
  const r = featureFromFace(model, f, { tipRadius: PROBE.nominalTipRadius, retract: PROBE.retract, distance: dist, name }, as)
  if ("error" in r) throw new Error(r.error)
  return r.step
}

describe("STEP 模型 → 自动识别面", () => {
  it("B-rep 面：平面、孔、凸台、横孔都能认出来", () => {
    expect(model.faceSource).toBe("brep")
    expect(model.faceCount).toBe(16)
    const kinds = Array.from({ length: model.faceCount }, (_, i) => analyzeFace(model, i))
    const holes = kinds.filter((f) => f.kind === "cylinder" && f.inner)
    const bosses = kinds.filter((f) => f.kind === "cylinder" && !f.inner)
    expect(kinds.filter((f) => f.kind === "plane").length).toBe(9)
    expect(holes.map((h) => +(h.radius! * 2).toFixed(3)).sort((a, b) => a - b)).toEqual([10, 12, 12, 12, 12, 20])
    expect(bosses).toHaveLength(1)
    expect(bosses[0].radius! * 2).toBeCloseTo(40, 2)
    const cross = holes.find((h) => Math.abs(h.radius! - 5) < 0.01)!
    expect(Math.abs(cross.axis!.y)).toBeCloseTo(1, 5)
  })

  it("孔：测点在孔壁上、触测方向沿径向朝外，横孔带孔口进入点", () => {
    const corner = faceWhere((f) => f.kind === "cylinder" && !!f.inner && Math.abs(f.radius! - 6) < 0.01)
    const step = build(corner, "孔1")
    expect(step.kind).toBe("circle")
    expect(step.points).toHaveLength(4)
    for (const p of step.points) {
      expect(dist.distance(p.nominal)).toBeLessThan(0.02)
      expect(Math.abs(p.approach.z)).toBeLessThan(1e-6)
    }
    expect(step.entry!.z).toBeGreaterThan(30)
    const cross = build(
      faceWhere((f) => f.kind === "cylinder" && !!f.inner && Math.abs(f.radius! - 5) < 0.01),
      "横孔"
    )
    expect(Math.abs(cross.entry!.z - 12)).toBeLessThan(1e-6)
    expect(cross.entry!.y < 0 || cross.entry!.y > 110).toBe(true)
  })

  it("平面撒点离边至少测针半径 + 1.5 mm，侧面可以生成直线", () => {
    const top = faceWhere((f) => f.kind === "plane" && f.normal!.z > 0.99 && Math.abs(f.point!.z - 30) < 1e-3)
    const plane = build(top, "顶面")
    expect(plane.points.length).toBe(5)
    for (const p of plane.points) {
      expect(p.nominal.z).toBeCloseTo(30, 4)
      expect(p.approach.x).toBeCloseTo(0, 9)
      expect(p.approach.y).toBeCloseTo(0, 9)
      expect(p.approach.z).toBeCloseTo(-1, 9)
    }
    const front = faceWhere((f) => f.kind === "plane" && f.normal!.y < -0.99)
    const line = build(front, "前侧边", "line")
    expect(line.kind).toBe("line")
    expect(line.points.length).toBe(3)
  })

  it("STL 没有 B-rep 时按法向分面，同样认出孔", () => {
    const stl = buildModel("lb02.stl", "stl", parseStl(readFileSync("/tmp/stp/lb02.stl").buffer as ArrayBuffer))
    const holes = Array.from({ length: stl.faceCount }, (_, i) => analyzeFace(stl, i)).filter(
      (f) => f.kind === "cylinder" && f.inner && Math.abs(f.radius! - 6) < 0.05
    )
    expect(holes.length).toBe(4)
  })
})

function instantDriver(truth: SimTruth, random: () => number): ProbeDriver {
  let pos = { x: 0, y: 0, z: 300 }
  return {
    position: () => pos,
    moveTo: async (p) => {
      pos = { ...p }
    },
    probe: async (dir, maxTravel) => {
      const r = simulateTouch(truth, pos, dir, maxTravel, random)
      if (r.kind === "collision") throw new Error("collision")
      if (r.kind === "hit") {
        pos = r.center
        return r.center
      }
      return null
    },
  }
}

describe("模型选点 → 自动轨迹 → 仿真测量 → 最佳拟合", () => {
  it("反算出的装夹位姿与仿真真值一致（< 3 μm / 0.001°）", async () => {
    const steps = [
      build(faceWhere((f) => f.kind === "plane" && f.normal!.z > 0.99 && Math.abs(f.point!.z - 30) < 1e-3), "顶面"),
      build(faceWhere((f) => f.kind === "plane" && f.normal!.y < -0.99), "前侧边", "line"),
      build(faceWhere((f) => f.kind === "plane" && f.normal!.x < -0.99), "左侧面"),
      ...Array.from({ length: model.faceCount }, (_, i) => analyzeFace(model, i))
        .filter((f) => f.kind === "cylinder")
        .map((f, i) => build(f, `圆${i + 1}`)),
    ]
    const program: MeasurementProgram = { id: "lb02", name: "LB-02", steps, gdt: [] }
    const onPallet = modelOnPallet(model, { rx: 0, ry: 0, rz: 0 })
    const random = seeded(11)
    const truth = createTruth(random, { nominalOnPallet: onPallet, model: dist })
    const placement = nominalPartToMachine(truth.palletToMachine, onPallet)
    const top = modelBoundsIn(model, placement).max.z
    const opts: RunOptions = {
      placement,
      clearanceZ: top + PROBE.clearanceAbovePart,
      tipRadius: truth.tipRadius,
      retract: PROBE.retract,
      searchTravel: PROBE.searchTravel,
      rapidSpeed: 200,
      measureSpeed: 50,
      probeSpeed: 5,
      checkPath: (a, b) => (segmentClearance(truth, a, b, 0.2) < 0 ? "碰撞风险" : null),
    }

    const plan = await planProgram(program, { x: 0, y: 0, z: 300 }, opts)
    expect(plan.issues).toEqual([])
    expect(plan.moves.filter((m) => m.kind === "touch")).toHaveLength(steps.reduce((n, s) => n + s.points.length, 0))
    expect(plan.seconds).toBeGreaterThan(10)

    const hits = await executeProgram(program, instantDriver(truth, random), opts)
    expect(hits.filter((h) => h.error)).toEqual([])

    const evaluation = evaluateProgram(program, hits, {
      tipRadius: truth.tipRadius,
      palletToMachine: truth.palletToMachine,
      nominalPartToPallet: onPallet,
      placement,
    })
    expect(evaluation.aligned).toBe(true)
    expect(evaluation.alignmentNote).toContain("最佳拟合")
    const got = toPoseDeg(evaluation.partToMachine)
    const want = toPoseDeg(compose(truth.palletToMachine, truth.partToPallet))
    expect(Math.abs(got.x - want.x)).toBeLessThan(0.003)
    expect(Math.abs(got.y - want.y)).toBeLessThan(0.003)
    expect(Math.abs(got.z - want.z)).toBeLessThan(0.003)
    expect(Math.abs(got.rz - want.rz)).toBeLessThan(0.001)
    const bore = evaluation.features.find((f) => f.name.startsWith("圆") && Math.abs((f.diameter ?? 0) - 20) < 0.05)
    expect(bore?.ok).toBe(true)
    const corner = applyPoint(evaluation.partToMachine, { x: 160, y: 110, z: 0 })
    const trueCorner = applyPoint(compose(truth.palletToMachine, truth.partToPallet), { x: 160, y: 110, z: 0 })
    expect(Math.hypot(corner.x - trueCorner.x, corner.y - trueCorner.y)).toBeLessThan(0.004)
    expect(PALLET.size.x).toBeGreaterThan(0)
  }, 60000)
})
