import { describe, expect, it } from "vitest"
import { workOffsetFromPose } from "@/lib/coords/work-offset"
import { DEFAULT_MACHINE_TOOL, NOMINAL_PART_ON_PALLET, PALLET, PLATE, PROBE, nominalPartToMachine } from "@/lib/machine/setup"
import { applyPoint, compose, toPoseDeg } from "@/lib/math/transform"
import { transformNcProgram } from "@/lib/nc/transform"
import { createDemoProgram, createPostProgram } from "@/lib/program/demo"
import { appliedThermal } from "@/lib/measure/thermal"
import { calibrateFromSphere, evaluateProgram, sphereTouchTargets } from "@/lib/program/evaluate"
import { executeProgram, touchSequence, type ProbeDriver, type RunOptions } from "@/lib/program/runner"
import { createTruth, segmentClearance, simulateTouch, type SimTruth } from "@/lib/sim/world"

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

function options(truth: SimTruth, placement: RunOptions["placement"], tipRadius: number, clearanceZ: number): RunOptions {
  return {
    placement,
    clearanceZ,
    tipRadius,
    retract: PROBE.retract,
    searchTravel: PROBE.searchTravel,
    rapidSpeed: 1,
    measureSpeed: 1,
    probeSpeed: 1,
    checkPath: (a, b) => (segmentClearance(truth, a, b, 0.2) < 0 ? "碰撞风险" : null),
  }
}

describe("预检闭环（仿真）", () => {
  for (const seed of [1, 7, 42]) {
    it(`种子 ${seed}：标定 → 测量 → 反算装夹偏差 → G54 → 改写程序`, async () => {
      const random = seeded(seed)
      const truth = createTruth(random)
      const driver = instantDriver(truth, random)

      const sphere = PALLET.referenceSphere
      const nominalSphere = applyPoint(PALLET.nominalToMachine, sphere.center)
      const cal = await touchSequence(
        driver,
        sphereTouchTargets(nominalSphere, sphere.radius),
        options(truth, PALLET.nominalToMachine, PROBE.nominalTipRadius, nominalSphere.z + 30),
        false
      )
      expect(cal.missed).toEqual([])
      const calibration = calibrateFromSphere(
        cal.hits.map((h) => h.center),
        sphere.radius,
        sphere.center,
        PALLET.nominalToMachine
      )
      expect(calibration.tipRadius).toBeCloseTo(truth.tipRadius, 3)
      expect(calibration.palletToMachine.t.x).toBeCloseTo(truth.palletToMachine.t.x, 3)
      expect(calibration.palletToMachine.t.z).toBeCloseTo(truth.palletToMachine.t.z, 3)

      const placement = nominalPartToMachine(calibration.palletToMachine)
      const program = createDemoProgram()
      const clearanceZ = applyPoint(placement, { x: 0, y: 0, z: 0 }).z + PROBE.clearanceAbovePart
      const hits = await executeProgram(
        program,
        driver,
        options(truth, placement, calibration.tipRadius, clearanceZ)
      )
      expect(hits.every((h) => !h.error)).toBe(true)

      const evaluation = evaluateProgram(program, hits, {
        tipRadius: calibration.tipRadius,
        palletToMachine: calibration.palletToMachine,
        nominalPartToPallet: NOMINAL_PART_ON_PALLET,
        placement,
      })
      expect(evaluation.aligned).toBe(true)

      const got = evaluation.pallet.actual
      const want = truth.partPose
      expect(Math.abs(got.x - want.x)).toBeLessThan(0.002)
      expect(Math.abs(got.y - want.y)).toBeLessThan(0.002)
      expect(Math.abs(got.z - want.z)).toBeLessThan(0.002)
      expect(Math.abs(got.rz - want.rz)).toBeLessThan(0.001)

      const holeA = evaluation.features.find((f) => f.stepId === "feat-hole-A")!
      expect(holeA.diameter! / 2).toBeCloseTo(truth.holes[0].r, 2)
      expect(Math.abs(holeA.inPart!.x - truth.holes[0].x)).toBeLessThan(0.002)
      expect(evaluation.gdt.find((g) => g.checkId === "gdt-pos-feat-hole-A")!.passed).toBe(true)

      const truePartToMachine = compose(truth.palletToMachine, truth.partToPallet)
      const trueCorner = applyPoint(truePartToMachine, { x: PLATE.w, y: PLATE.d, z: 0 })
      const measuredCorner = applyPoint(evaluation.partToMachine, { x: PLATE.w, y: PLATE.d, z: 0 })
      expect(Math.hypot(trueCorner.x - measuredCorner.x, trueCorner.y - measuredCorner.y)).toBeLessThan(0.003)

      const wo = workOffsetFromPose(got, DEFAULT_MACHINE_TOOL)
      expect(wo.x).toBeCloseTo(DEFAULT_MACHINE_TOOL.palletZeroOnMachine.x + want.x, 2)

      const nc = transformNcProgram("G90 G00 X200. Y140.", evaluation.pallet.deltaInNominalPart)
      const [, x, y] = nc.output.match(/X(-?[\d.]+) Y(-?[\d.]+)/)!.map(Number)
      const inNominal = applyPoint(NOMINAL_PART_ON_PALLET, { x, y, z: 0 })
      const inActual = applyPoint(truth.partToPallet, { x: PLATE.w, y: PLATE.d, z: 0 })
      expect(Math.hypot(inNominal.x - inActual.x, inNominal.y - inActual.y)).toBeLessThan(0.003)
      expect(toPoseDeg(evaluation.pallet.deltaInNominalPart).rz).toBeCloseTo(want.rz, 2)
    })
  }

  it("零件升温后，孔径补偿回 20 °C 图纸尺寸", async () => {
    const random = seeded(11)
    const truth = createTruth(random)
    truth.noise = 0
    truth.partTempC = 40
    truth.partAlpha = 23e-6
    const driver = instantDriver(truth, () => 0.5)
    const placement = nominalPartToMachine(truth.palletToMachine)
    const program = createPostProgram()
    const clearanceZ = applyPoint(placement, { x: 0, y: 0, z: 0 }).z + PROBE.clearanceAbovePart
    const hits = await executeProgram(program, driver, options(truth, placement, truth.tipRadius, clearanceZ))
    const thermal = appliedThermal({ enabled: true, material: "aluminum", partTempC: 40 })
    const evaluation = evaluateProgram(program, hits, {
      tipRadius: truth.tipRadius,
      palletToMachine: truth.palletToMachine,
      nominalPartToPallet: NOMINAL_PART_ON_PALLET,
      placement,
      thermal,
    })
    const holeA = evaluation.features.find((f) => f.stepId === "feat-hole-A")!
    expect(holeA.sizeCheck?.passed).toBe(true)
    expect(Math.abs(holeA.diameter! / 2 - truth.holes[0].r)).toBeLessThan(0.002)
  })

  it("路径与工件干涉时拒绝运动", async () => {
    const truth = createTruth(seeded(3))
    const driver = instantDriver(truth, seeded(3))
    const placement = nominalPartToMachine(truth.palletToMachine)
    const opts = options(truth, placement, truth.tipRadius, 40)
    await expect(
      touchSequence(
        driver,
        [{ id: "bad", surface: applyPoint(placement, { x: 100, y: 70, z: 0 }), approach: { x: 0, y: 0, z: -1 } }],
        opts,
        false
      )
    ).rejects.toThrow("碰撞风险")
  })
})
