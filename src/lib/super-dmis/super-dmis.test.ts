import { describe, expect, it } from "vitest"
import { NOMINAL_PART_ON_PALLET, PALLET, nominalPartToMachine } from "@/lib/machine/setup"
import { createDemoProgram } from "@/lib/program/demo"
import { evaluateProgram } from "@/lib/program/evaluate"
import { compensatePoint, emptyGeom21, volumetricError } from "@/lib/super-dmis/geom21"
import { exportSuperDmis, superDmisSafeName } from "@/lib/super-dmis/dmis"
import { detectAndParse } from "@/lib/super-dmis/import-file"
import { parseStepGaugeDat } from "@/lib/super-dmis/parse-dat"
import { matchImportedHits, parseMeasurementFile, programFromImport } from "@/lib/super-dmis/parse-hits"
import { parseNonlinear } from "@/lib/super-dmis/parse-nonlinear"

describe("X-Inspect 步距规 .dat", () => {
  it("按说明书读取「理论值 mm，偏差值 µm」", () => {
    const g = parseStepGaugeDat("50.000, 1.2\r\n100.000\t-0.5\n")
    expect(g.segments).toHaveLength(2)
    expect(g.segments[0].actualMm).toBeCloseTo(50.0012, 8)
    expect(g.segments[1].actualMm).toBeCloseTo(99.9995, 8)
  })
})

describe("X-Inspect 非线性表", () => {
  it("读取 RationalDMIS 风格 AXIS/X 表", () => {
    const text = [
      "AXIS/X",
      "0 0 0 0 0 0 0",
      "100 0.010 0 0 0 0 0",
      "AXIS/Y",
      "0 0 0 0 0 0 0",
      "80 0 0.004 0 0 0 0",
    ].join("\n")
    const g = parseNonlinear(text, "comp.txt")
    expect(g.x).toHaveLength(2)
    expect(g.y).toHaveLength(2)
    const p = compensatePoint(g, { x: 50, y: 40, z: 10 })
    expect(p.x).toBeCloseTo(50 - 0.005, 6)
    expect(p.y).toBeCloseTo(40 - 0.002, 6)
  })

  it("读取 Other CSV，并把大转角按 µrad 换算", () => {
    const text = [
      "axis,pos,linX,linY,linZ,rotX,rotY,rotZ",
      "X,0,0,0,0,0,0,0",
      "X,200,0,0,0,0,0,10",
    ].join("\n")
    const g = parseNonlinear(text)
    expect(g.x[1].rot.z).toBeCloseTo(10e-6, 12)
  })
})

describe("21 项误差模型", () => {
  it("分辨率 理论/实测 把指示值缩回真值", () => {
    const g = emptyGeom21()
    g.resolution = { x: 0.5, y: 1, z: 1 }
    expect(compensatePoint(g, { x: 10, y: 0, z: 0 }).x).toBeCloseTo(5, 12)
  })

  it("垂直度 Cxy 只改 X（Y 相对 X 不垂直）", () => {
    const g = emptyGeom21()
    g.squareness.xy = 0.001
    const e = volumetricError(g, { x: 0, y: 100, z: 0 })
    expect(e.x).toBeCloseTo(0.1, 12)
    expect(e.y).toBeCloseTo(0, 12)
  })
})

describe("SuperDMIS 测点导入", () => {
  it("解析 PTMEAS 并按特征名对上预检程序", () => {
    const program = createDemoProgram()
    const dmis = exportSuperDmis(program)
    expect(dmis.startsWith("DMISMN/")).toBe(true)
    expect(superDmisSafeName("夹具底板 预检.dms")).toBe("PRECHECK.dms")
    expect(superDmisSafeName("BP-01_precheck")).toBe("BP-01_precheck.dms")

    const measured = dmis.replace(/PTMEAS\/CART,([-\d.]+),([-\d.]+),([-\d.]+),/g, (_m, x, y, z) => {
      return `PTMEAS/CART,${Number(x) + 0.2},${Number(y) - 0.1},${Number(z) + 0.05},`
    })
    const imported = parseMeasurementFile(measured)
    expect(imported.format).toBe("dmis")
    expect(imported.features.length).toBe(program.steps.length)

    const hits = matchImportedHits(program, imported.features)
    const evaluation = evaluateProgram(program, hits, {
      tipRadius: 2,
      palletToMachine: PALLET.nominalToMachine,
      nominalPartToPallet: NOMINAL_PART_ON_PALLET,
      placement: nominalPartToMachine(PALLET.nominalToMachine),
    })
    expect(evaluation.features.every((f) => f.ok)).toBe(true)
    expect(evaluation.aligned).toBe(true)
  })

  it("解析 X-Inspect 报告里的平面/线/点", () => {
    const text = [
      "平面",
      "1 10 20 30",
      "2 40 20 30",
      "3 40 50 30",
      "线",
      "1 10 0 20",
      "2 40 0 20",
      "点",
      "1 0 15 20",
    ].join("\n")
    const imported = parseMeasurementFile(text)
    expect(imported.format).toBe("xinspect-report")
    expect(imported.features.map((f) => f.kind)).toEqual(["plane", "line", "point"])
    const program = programFromImport(imported.features)
    expect(program.alignment).toBeTruthy()
  })

  it("detectAndParse 按扩展名走步距规", () => {
    const r = detectAndParse("25.0, 2\n50.0, 0\n", "step.dat")
    expect(r.kind).toBe("step-gauge")
  })
})
