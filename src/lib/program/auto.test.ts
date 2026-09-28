import { describe, expect, it } from "vitest"
import { autoProgram, type PartModel } from "@/lib/program/auto"
import { PLATE_MODEL } from "@/lib/program/demo"
import { exportDmis } from "@/lib/program/dmis"

describe("自动编程", () => {
  it("预调只生成三个基准，并自动指定 3-2-1", () => {
    const program = autoProgram(PLATE_MODEL, "preset")
    expect(program.steps.map((s) => s.id)).toEqual(["feat-top", "feat-front", "feat-left"])
    expect(program.alignment).toEqual({ primary: "feat-top", secondary: "feat-front", origin: "feat-left" })
    expect(program.steps[0].points).toHaveLength(5)
  })

  it("复测先测基准，再从原点出发按最近邻测孔，第一个孔的上下沿连在一起", () => {
    const program = autoProgram(PLATE_MODEL, "post")
    expect(program.steps.map((s) => s.id)).toEqual([
      "feat-top",
      "feat-front",
      "feat-left",
      "feat-hole-A",
      "feat-hole-A-lower",
      "feat-hole-C",
      "feat-hole-D",
      "feat-hole-B",
    ])
    expect(program.gdt.some((g) => g.type === "coaxiality" && g.datumIds?.[0] === "feat-hole-A")).toBe(true)
    expect(program.steps.filter((s) => s.kind === "circle").every((s) => s.sizeTolerance === 0.03)).toBe(true)
  })

  it("薄零件不在孔下沿再测一圈，侧面触测高度跟着板厚变浅", () => {
    const thin: PartModel = { ...PLATE_MODEL, id: "thin", h: 6 }
    const program = autoProgram(thin, "post")
    expect(program.steps.some((s) => s.id.endsWith("-lower"))).toBe(false)
    expect(program.steps.find((s) => s.id === "feat-front")!.points[0].nominal.z).toBeCloseTo(-2.4, 6)
  })

  it("导出 DMIS：每个特征一段 MEAS，点数与程序一致，矢量为表面外法向", () => {
    const program = autoProgram(PLATE_MODEL, "post")
    const text = exportDmis(program)
    expect(text.startsWith("DMISMN/")).toBe(true)
    expect(text.trim().endsWith("ENDFIL")).toBe(true)
    expect(text.match(/^MEAS\//gm)).toHaveLength(program.steps.length)
    const total = program.steps.reduce((n, s) => n + s.points.length, 0)
    expect(text.match(/PTMEAS\//g)).toHaveLength(total)
    expect(text).toContain("F(TOP)=FEAT/PLANE,CART,15.0000,15.0000,0.0000,0.0000,0.0000,1.0000")
    expect(text).toContain("F(HOLE_A)=FEAT/CIRCLE,INNER,CART,40.0000,30.0000,-4.0000,0.0000,0.0000,1.0000,16.0000")
  })
})
