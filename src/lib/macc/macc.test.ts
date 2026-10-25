import { describe, expect, it } from "vitest"
import { maccErrorMessage, maccOk, MACC_TEMP_PAIRING } from "@/lib/macc/errors"
import { decodeIpp, encodeIpp, ippGoTo, ippHome, ippPtMeas } from "@/lib/macc/iplusplus"
import { sphereLocateStart, SPHERE_LOCATE_CLEARANCE_MM } from "@/lib/macc/probe-qualify"
import { MOTION_ESTOP, MOTION_TOUCHING, parseAxisHomed, parseMotionStatus } from "@/lib/macc/status"

describe("MACC 返回码", () => {
  it("0 为成功，517 为未解密", () => {
    expect(maccOk(0)).toBe(true)
    expect(maccErrorMessage(517)).toContain("未解密")
    expect(maccErrorMessage(4435)).toContain("搜索失败")
  })

  it("温度补偿必须配套 SetupTool 3.16 与 IPPServer 4.08", () => {
    expect(MACC_TEMP_PAIRING.setupTool).toContain("3.16")
    expect(MACC_TEMP_PAIRING.ippServer).toContain("4.08")
  })
})

describe("状态字", () => {
  it("解析急停和采点进行中", () => {
    const m = parseMotionStatus(0x0400 | 0x8000)
    expect(m.estop).toBe(true)
    expect(m.touching).toBe(true)
    expect(MOTION_ESTOP).toBe(0x0400)
    expect(MOTION_TOUCHING).toBe(0x8000)
  })

  it("三轴 bit11 都置位才算已回零", () => {
    expect(parseAxisHomed([0x0800, 0x0800, 0x0800])).toBe(true)
    expect(parseAxisHomed([0x0800, 0, 0x0800])).toBe(false)
  })
})

describe("IPPServer 标准球定位", () => {
  it("探针球心停在球顶上方 10 mm", () => {
    const p = sphereLocateStart({ x: 0, y: 0, z: 12 }, 5)
    expect(p.z).toBe(12 + 5 + SPHERE_LOCATE_CLEARANCE_MM)
  })
})

describe("IPPServer I++ 1.7 帧", () => {
  it("5 位长度前缀含 CRLF", () => {
    const frame = encodeIpp(ippHome())
    expect(frame.startsWith("00008")).toBe(true)
    expect(frame.endsWith("Home()\r\n")).toBe(true)
    expect(decodeIpp(frame)).toBe("Home()")
  })

  it("PtMeas / GoTo 带 IJK 和坐标", () => {
    expect(ippGoTo({ x: 1, y: 2, z: 3 })).toBe("GoTo(X(1.0000),Y(2.0000),Z(3.0000))")
    expect(ippPtMeas({ x: 10, y: 0, z: 5 }, { x: 0, y: 0, z: -1 })).toContain("IJK(0.0000,0.0000,-1.0000)")
  })
})
