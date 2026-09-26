import { describe, expect, it } from "vitest"
import { checkTravel, SAMPLE_NC, transformNcProgram } from "@/lib/nc/transform"
import { fromPoseDeg, identityTransform } from "@/lib/math/transform"

const rot90 = fromPoseDeg({ x: 10, y: 5, z: 0.5, rz: 90, ry: 0, rx: 0 })

describe("transformNcProgram", () => {
  it("恒等变换不改变任何坐标值", () => {
    const res = transformNcProgram(SAMPLE_NC, identityTransform())
    const nums = (s: string) => [...s.matchAll(/[XYZIJ](-?[\d.]+)/g)].map((m) => Number(m[1]))
    expect(nums(res.output)).toEqual(expect.arrayContaining(nums(SAMPLE_NC)))
    expect(res.warnings).toEqual([])
  })

  it("旋转后单轴移动要补齐另一轴", () => {
    const res = transformNcProgram("G90 G00 X0 Y0\nG01 X20. F100", rot90)
    const lines = res.output.split("\n")
    expect(lines[0]).toBe("G90 G00 X10.0000 Y5.0000")
    expect(lines[1]).toBe("G01 X10.0000 Y25.0000 F100")
  })

  it("Z 平移，F/S/H/D 不动，注释保留", () => {
    const res = transformNcProgram("G00 X0 Y0\nG43 Z30. H01 (安全高度)\nS3000 M03", rot90)
    expect(res.output.split("\n")[1]).toBe("G43 Z30.5000 H01 (安全高度)")
    expect(res.output.split("\n")[2]).toBe("S3000 M03")
  })

  it("圆弧 I/J 随旋转，R 不变", () => {
    const res = transformNcProgram("G90 G00 X10 Y0\nG02 X20 Y0 I5 J0\nG03 X10 Y0 R5", rot90)
    const lines = res.output.split("\n")
    expect(lines[1]).toBe("G02 X10.0000 Y25.0000 I0.0000 J5.0000")
    expect(lines[2]).toBe("G03 X10.0000 Y15.0000 R5")
  })

  it("增量坐标只旋转不平移", () => {
    const res = transformNcProgram("G00 X0 Y0\nG91 G01 X10", rot90)
    expect(res.output.split("\n")[1]).toBe("G91 G01 X0.0000 Y10.0000")
  })

  it("钻孔循环 R 平面随 Z 平移", () => {
    const res = transformNcProgram("G00 X0 Y0\nG81 X40. Y30. Z-22. R2. F120\nX160.", rot90)
    const lines = res.output.split("\n")
    expect(lines[1]).toBe("G81 X-20.0000 Y45.0000 Z-21.5000 R2.5000 F120")
    expect(lines[2]).toBe("X-20.0000 Y165.0000")
  })

  it("机械坐标、坐标系设定、宏程序原样保留并告警", () => {
    const src = "G53 G00 Z0\nG10 L2 P1 X0 Y0 Z0\n#100=5\nG68 X0 Y0 R1"
    const res = transformNcProgram(src, rot90)
    expect(res.output.split("\n").slice(0, 3)).toEqual(src.split("\n").slice(0, 3))
    expect(res.warnings.length).toBe(4)
  })

  it("行程检查", () => {
    const res = transformNcProgram(SAMPLE_NC, identityTransform())
    const issues = checkTravel(res.bounds, { x: -10, y: -10, z: -10 }, {
      min: { x: -850, y: -500, z: -550 },
      max: { x: 0, y: 0, z: 0 },
    })
    expect(issues.some((m) => m.startsWith("X 轴最大"))).toBe(true)
  })
})
