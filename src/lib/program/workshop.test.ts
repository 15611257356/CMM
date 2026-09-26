import { describe, expect, it } from "vitest"
import { MATERIALS, appliedThermal, thermalScale } from "@/lib/measure/thermal"
import { createDemoProgram, createPostProgram, createPresetProgram } from "@/lib/program/demo"
import { setAlignmentRole, setCircleSpec, setPointCount } from "@/lib/program/edit"
import { indicateEdge } from "@/lib/program/indicator"

describe("温度补偿", () => {
  it("20 °C 时缩放为 1", () => {
    expect(thermalScale(MATERIALS.aluminum.alpha, 20)).toBe(1)
    expect(appliedThermal({ enabled: true, material: "aluminum", partTempC: 20 }).scale).toBe(1)
  })

  it("铝合金升温 20 °C，每米伸长 0.46 mm", () => {
    const scale = appliedThermal({ enabled: true, material: "aluminum", partTempC: 40 }).scale
    expect((scale - 1) * 1000).toBeCloseTo(0.46, 6)
  })

  it("关闭补偿时不缩放", () => {
    expect(appliedThermal({ enabled: false, material: "aluminum", partTempC: 40 }).scale).toBe(1)
  })
})

describe("测量程序编辑", () => {
  it("预调只保留三个基准，复测给孔加直径公差", () => {
    const preset = createPresetProgram()
    expect(preset.steps.map((s) => s.kind)).toEqual(["plane", "line", "point"])
    expect(preset.alignment?.primary).toBe("feat-top")
    const post = createPostProgram()
    expect(post.steps.filter((s) => s.kind === "circle").every((s) => s.sizeTolerance === 0.03)).toBe(true)
  })

  it("改孔径会重算触测点，找正可以只指定一项", () => {
    const program = createDemoProgram()
    const hole = program.steps.find((s) => s.id === "feat-hole-A")!
    const edited = setCircleSpec(program, hole.id, { diameter: 20 })
    const next = edited.steps.find((s) => s.id === hole.id)!
    expect(next.nominalRadius).toBe(10)
    expect(Math.hypot(next.points[0].nominal.x - hole.nominalCenter!.x, next.points[0].nominal.y - hole.nominalCenter!.y)).toBeCloseTo(10, 6)

    const counted = setPointCount(edited, "feat-top", 4)
    expect(counted.steps.find((s) => s.id === "feat-top")!.points).toHaveLength(4)

    const partial = setAlignmentRole(program, "origin", null)
    expect(partial.program.alignment?.origin).toBeUndefined()
    expect(partial.program.alignment?.primary).toBe("feat-top")
    const wrong = setAlignmentRole(program, "primary", "feat-front")
    expect(wrong.error).toBeTruthy()
  })
})

describe("千分表找正", () => {
  it("沿 X 每 100 mm 读数增加 0.1 mm，转角约为 0.0573°", () => {
    const result = indicateEdge([
      { position: { x: 0, y: 0, z: 0 }, readingMm: 0 },
      { position: { x: 100, y: 0, z: 0 }, readingMm: 0.05 },
      { position: { x: 200, y: 0.2, z: 0 }, readingMm: 0.1 },
    ])
    expect(result?.travel).toBe("x")
    expect(result?.angleDeg).toBeCloseTo((Math.atan(0.1 / 200) * 180) / Math.PI, 3)
    expect(result?.spanMm).toBeCloseTo(200, 6)
  })

  it("只有一个点或行程太短时不算", () => {
    expect(indicateEdge([{ position: { x: 0, y: 0, z: 0 }, readingMm: 0 }])).toBeNull()
    expect(
      indicateEdge([
        { position: { x: 0, y: 0, z: 0 }, readingMm: 0 },
        { position: { x: 2, y: 0, z: 0 }, readingMm: 0.01 },
      ])
    ).toBeNull()
  })
})
