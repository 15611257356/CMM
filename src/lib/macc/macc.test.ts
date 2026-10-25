import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { maccErrorMessage, maccOk, MACC_TEMP_PAIRING } from "@/lib/macc/errors"
import { detectAndParse } from "@/lib/super-dmis/import-file"
import { parseSetupToolConfig, uintToIpv4 } from "@/lib/macc/setuptool"
import {
  encodeIpp,
  ippGoTo,
  ippHome,
  ippPtMeas,
  ippTag,
  ippXyz,
  parseIppError,
  parseIppLine,
} from "@/lib/macc/iplusplus"
import { sphereLocateStart, SPHERE_LOCATE_CLEARANCE_MM } from "@/lib/macc/probe-qualify"
import { MOTION_ESTOP, MOTION_TOUCHING, parseAxisHomed, parseMotionStatus } from "@/lib/macc/status"

describe("MACC 返回码", () => {
  it("0 为成功，517 为未解密", () => {
    expect(maccOk(0)).toBe(true)
    expect(maccErrorMessage(517)).toContain("未解密")
    expect(maccErrorMessage(4435)).toContain("搜索失败")
  })

  it("温度补偿必须配套 SetupTool 3.33 与 IPPServer 4.08", () => {
    expect(MACC_TEMP_PAIRING.setupTool).toContain("3.33")
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

describe("SetupTool V3.33 config.xml", () => {
  const sample = `<?xml version="1.0" encoding="utf-8"?>
<Configuration Axis="5" ControllerType="MACC3000">
  <NetConfig Name="网络参数">
    <key Name="控制器IP地址" Value="2147483657" ValType="uint" />
    <key Name="控制器子网掩码" Value="4294901760" ValType="uint" />
    <key Name="控制器网关地址" Value="2147483649" ValType="uint" />
    <key Name="控制器通讯端口" Value="10000" ValType="ushort" />
  </NetConfig>
  <MeasurePara>
    <key Name="回退距离" Value="3.000000" Unit="mm" />
    <key Name="回退速度" Value="10.000000" Unit="mm/s" />
    <key Name="搜索距离默认值" Value="2.000000" Unit="mm" />
    <key Name="默认测量速度" Value="5.000000" Unit="mm/s" />
    <key Name="默认定位速度" Value="150.000000" Unit="mm/s" />
    <key Name="温度补偿使能" Value="2" />
    <key Name="温度采集通道1" Value="3" />
  </MeasurePara>
</Configuration>`

  it("把出厂 uint IP 解成 128.0.0.9:10000，并读回退/搜索", () => {
    expect(uintToIpv4(2147483657)).toBe("128.0.0.9")
    const p = parseSetupToolConfig(sample)
    expect(p.controllerType).toBe("MACC3000")
    expect(p.ip).toBe("128.0.0.9")
    expect(p.port).toBe(10000)
    expect(p.retractMm).toBe(3)
    expect(p.searchMm).toBe(2)
    expect(p.temperatureChannels[0]).toBe(3)
    expect(detectAndParse(sample, "config.xml").kind).toBe("setuptool")
  })
})

describe("IPPServer 标准球定位", () => {
  it("探针球心停在球顶上方 10 mm", () => {
    const p = sphereLocateStart({ x: 0, y: 0, z: 12 }, 5)
    expect(p.z).toBe(12 + 5 + SPHERE_LOCATE_CLEARANCE_MM)
  })
})

describe("IPPServer I++ 1.7 帧", () => {
  it("5 位是指令标签，不是长度", () => {
    expect(encodeIpp(ippTag(1), ippHome())).toBe("00001 Home()\r\n")
    expect(encodeIpp(ippTag(2, true), "AbortE()")).toBe("E0002 AbortE()\r\n")
    expect(ippTag(10000)).toBe("00001")
  })

  it("解析 & # % ! 与事件", () => {
    expect(parseIppLine("00003 &")).toEqual({ tag: "00003", kind: "ack", body: "" })
    expect(parseIppLine("00003 %")?.kind).toBe("done")
    const data = parseIppLine("00003 # X(10.5000), Y(-2.0000), Z(30.1250)")!
    expect(data.kind).toBe("data")
    expect(ippXyz(data.body)).toEqual({ x: 10.5, y: -2, z: 30.125 })
    expect(parseIppLine("E0001 # X(1), Y(2), Z(3)")?.kind).toBe("event")
    const err = parseIppLine('00004 ! Error(3, 1003, "GoTo", "Emergency stop")')!
    expect(err.kind).toBe("error")
    expect(parseIppError(err.body)).toEqual({ severity: 3, code: "1003", text: "Emergency stop" })
  })

  it("PtMeas / GoTo 带 IJK 和坐标", () => {
    expect(ippGoTo({ x: 1, y: 2, z: 3 })).toBe("GoTo(X(1.0000),Y(2.0000),Z(3.0000))")
    expect(ippPtMeas({ x: 10, y: 0, z: 5 }, { x: 0, y: 0, z: -1 })).toContain("IJK(0.0000,0.0000,-1.0000)")
  })
})

describe("VCC 系列调试软件 V3.41 config.xml", () => {
  it("VCC3500 出厂配置：识别型号、回退 / 搜索参数和软限位行程", () => {
    const xml = readFileSync(join(__dirname, "fixtures/vcc3500-v341-config.xml"), "utf8")
    const p = parseSetupToolConfig(xml)
    expect(p.family).toBe("VCC")
    expect(p.controllerType).toBe("VCC3500")
    expect(p.version).toBe("V3.41")
    expect(p.axisCount).toBe(4)
    expect(p.ip).toBe("128.0.0.9")
    expect(p.port).toBe(10000)
    expect(p.retractMm).toBe(2)
    expect(p.retractSpeed).toBe(40)
    expect(p.searchMm).toBe(20)
    expect(p.approachMm).toBe(10)
    expect(p.positionSpeed).toBe(50)
    expect(p.softLimits).toEqual({ min: { x: -300, y: -60, z: -20 }, max: { x: 4.531, y: 4.291, z: 4.531 } })
    expect(p.travel!.x).toBeCloseTo(304.531, 6)
    expect(p.scaleX).toBe(0.001)
  })
})
