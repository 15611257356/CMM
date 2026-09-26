import { describe, expect, it } from "vitest"
import { fitCircle, fitLine, fitPlane, fitSphere, probeCompensation } from "@/lib/measure/fit"
import { coaxiality, perpendicularity, positionDiameter } from "@/lib/measure/gdt"
import { add, normalize, orthonormalBasis, scale } from "@/lib/math/linalg"

const Z = { x: 0, y: 0, z: 1 }

describe("fitPlane", () => {
  it("拟合水平面并按提示定向法向", () => {
    const pts = [
      { x: 0, y: 0, z: 10 },
      { x: 50, y: 0, z: 10.002 },
      { x: 50, y: 40, z: 9.999 },
      { x: 0, y: 40, z: 10.001 },
    ]
    const fit = fitPlane(pts, Z)
    expect(fit.normal.z).toBeGreaterThan(0.999)
    expect(fit.flatness).toBeGreaterThan(0.001)
    expect(fit.flatness).toBeLessThan(0.004)
  })

  it("竖直基准侧面也能拟合（旧算法 z=ax+by+c 在这里会失败）", () => {
    const pts = [
      { x: 0, y: 5, z: 0 },
      { x: 100, y: 5, z: 0 },
      { x: 100, y: 5, z: -15 },
      { x: 0, y: 5, z: -15 },
    ]
    const fit = fitPlane(pts, { x: 0, y: -1, z: 0 })
    expect(fit.normal.y).toBeCloseTo(-1, 9)
    expect(fit.point.y).toBeCloseTo(5, 9)
    expect(fit.flatness).toBeCloseTo(0, 9)
  })
})

describe("fitCircle", () => {
  it("斜面上的孔：3D 几何最小二乘圆", () => {
    const axis = normalize({ x: 0.3, y: -0.2, z: 1 })
    const { u, v } = orthonormalBasis(axis)
    const center = { x: 12.3, y: -4.5, z: 7.8 }
    const pts = [0, 50, 130, 200, 290].map((deg) => {
      const a = (deg * Math.PI) / 180
      return add(center, add(scale(u, 6.25 * Math.cos(a)), scale(v, 6.25 * Math.sin(a))))
    })
    const fit = fitCircle(pts, axis)
    expect(fit.radius).toBeCloseTo(6.25, 9)
    expect(fit.center.x).toBeCloseTo(center.x, 9)
    expect(fit.center.y).toBeCloseTo(center.y, 9)
    expect(fit.center.z).toBeCloseTo(center.z, 9)
    expect(fit.circularity).toBeLessThan(1e-9)
  })

  it("只测一小段圆弧时仍收敛到真值", () => {
    const pts = [10, 25, 40, 55].map((deg) => {
      const a = (deg * Math.PI) / 180
      return { x: 100 + 30 * Math.cos(a), y: 50 + 30 * Math.sin(a), z: 0 }
    })
    const fit = fitCircle(pts, Z)
    expect(fit.radius).toBeCloseTo(30, 7)
    expect(fit.center.x).toBeCloseTo(100, 7)
  })
})

describe("fitLine / fitSphere", () => {
  it("直线度按平面内偏差计算", () => {
    const fit = fitLine(
      [
        { x: 0, y: 0, z: 0 },
        { x: 50, y: 0.003, z: 0 },
        { x: 100, y: 0, z: 0 },
      ],
      Z,
      { x: 1, y: 0, z: 0 }
    )
    expect(fit.direction.x).toBeCloseTo(1, 6)
    expect(fit.straightness).toBeCloseTo(0.003, 6)
  })

  it("球拟合", () => {
    const c = { x: 132, y: 288, z: 72 }
    const pts = [
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: -1, z: 0 },
      normalize({ x: 1, y: 1, z: 1 }),
    ].map((d) => add(c, scale(d, 7.0012)))
    const fit = fitSphere(pts)
    expect(fit.radius).toBeCloseTo(7.0012, 9)
    expect(fit.center.z).toBeCloseTo(72, 9)
  })
})

describe("测针半径补偿", () => {
  it("平面沿材料方向偏移一个测针半径", () => {
    const centers = [
      { x: 0, y: 0, z: 12 },
      { x: 10, y: 0, z: 12 },
      { x: 0, y: 10, z: 12 },
    ]
    const fit = probeCompensation.plane(fitPlane(centers, Z), 2)
    expect(fit.point.z).toBeCloseTo(10, 12)
  })

  it("孔径加 2r，轴径减 2r", () => {
    const pts = [0, 90, 180, 270].map((d) => {
      const a = (d * Math.PI) / 180
      return { x: 6 * Math.cos(a), y: 6 * Math.sin(a), z: 0 }
    })
    const raw = fitCircle(pts, Z)
    expect(probeCompensation.circle(raw, true, 2).radius).toBeCloseTo(8, 12)
    expect(probeCompensation.circle(raw, false, 2).radius).toBeCloseTo(4, 12)
  })
})

describe("形位公差", () => {
  it("同轴度按到基准轴线距离计算，而不是两个圆心的 XY 距离", () => {
    const value = coaxiality({ x: 0, y: 0, z: 0 }, normalize({ x: 0.01, y: 0, z: 1 }), { x: 0, y: 0, z: -16 })
    expect(value).toBeCloseTo(2 * 16 * Math.sin(Math.atan(0.01)), 9)
  })

  it("位置度为直径值", () => {
    expect(positionDiameter({ x: 40.003, y: 30.004, z: 0 }, { x: 40, y: 30, z: 0 })).toBeCloseTo(0.01, 9)
  })

  it("垂直度", () => {
    const pts = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 100, z: 0 },
      { x: 0.005, y: 0, z: -20 },
      { x: 0.005, y: 100, z: -20 },
    ]
    expect(perpendicularity(pts, { x: -1, y: 0, z: 0 }, Z)).toBeCloseTo(0.005, 9)
  })
})
