import type { Vec3 } from "@/lib/geom"

/**
 * 力合调试软件 SetupTool 的 Config/config.xml。两个系列格式相同：
 * - MACC 系列（MACC调试软件 V3.33）：MACC3000，出厂回退 3 mm / 10 mm/s，搜索 2 mm。
 * - VCC 系列（VCC系列控制器调试软件 V3.41）：VCC3500 四轴，回退 2 mm / 40 mm/s，搜索 20 mm。
 * 控制器都走以太网 128.0.0.9:10000。
 */
export const SETUPTOOL_VERSION = "V3.33"
export const VCC_SETUPTOOL_VERSION = "V3.41"

export type ControllerFamily = "MACC" | "VCC"

export type SetupToolProfile = {
  version: string
  family: ControllerFamily
  controllerType: string
  axisCount: number
  ip: string
  gateway: string
  mask: string
  port: number
  retractMm: number
  retractSpeed: number
  searchMm: number
  approachMm: number
  measureSpeed: number
  positionSpeed: number
  temperatureEnabledRaw: number
  temperatureChannels: number[]
  scaleX: number
  scaleY: number
  scaleZ: number
  /** 控制器软限位（光栅读数坐标）。IPPServer 机器坐标 = 读数 − 负软限位，零点在负限位处。 */
  softLimits?: { min: Vec3; max: Vec3 }
  /** 由软限位算出的行程（mm）。 */
  travel?: Vec3
}

function attr(tag: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1]
}

function parseKeys(xml: string): Map<string, string> {
  const map = new Map<string, string>()
  const re = /<key\b([^>]*)\/?>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const name = attr(m[1], "Name")
    if (name && !map.has(name)) map.set(name, attr(m[1], "Value") ?? "")
  }
  return map
}

function num(map: Map<string, string>, name: string, fallback: number): number {
  const raw = map.get(name)
  if (raw === undefined || raw === "") return fallback
  const v = Number(raw)
  return Number.isFinite(v) ? v : fallback
}

function maybe(map: Map<string, string>, name: string): number | undefined {
  const raw = map.get(name)
  if (raw === undefined || raw === "") return undefined
  const v = Number(raw)
  return Number.isFinite(v) ? v : undefined
}

/** SetupTool 把 IPv4 存成大端 uint32。出厂 2147483657 → 128.0.0.9 */
export function uintToIpv4(n: number): string {
  const u = n >>> 0
  return [(u >>> 24) & 255, (u >>> 16) & 255, (u >>> 8) & 255, u & 255].join(".")
}

export function isSetupToolConfig(text: string, filename = ""): boolean {
  return (
    /<Configuration\b[^>]*ControllerType=/.test(text) ||
    (/config\.xml$/i.test(filename) && /<NetConfig\b/.test(text) && /控制器IP地址/.test(text))
  )
}

export function parseSetupToolConfig(xml: string): SetupToolProfile {
  if (!/<Configuration\b/.test(xml) || !/控制器IP地址/.test(xml)) {
    throw new Error("不是 SetupTool 的 config.xml（需要 Configuration / 控制器IP地址）")
  }
  const head = xml.match(/<Configuration\b([^>]*)>/)?.[1] ?? ""
  const keys = parseKeys(xml)
  const controllerType = attr(head, "ControllerType") || "MACC"
  const family: ControllerFamily = /^VCC/i.test(controllerType) ? "VCC" : "MACC"
  const channels = Array.from({ length: 16 }, (_, i) => num(keys, `温度采集通道${i + 1}`, 0))
  const axes = ["X", "Y", "Z"] as const
  const lim = axes.map((a) => ({
    min: maybe(keys, `${a}轴负向软限位坐标`),
    max: maybe(keys, `${a}轴正向软限位坐标`),
  }))
  const hasLimits = lim.every((l) => l.min !== undefined && l.max !== undefined)
  const softLimits = hasLimits
    ? {
        min: { x: lim[0].min!, y: lim[1].min!, z: lim[2].min! },
        max: { x: lim[0].max!, y: lim[1].max!, z: lim[2].max! },
      }
    : undefined
  const vcc = family === "VCC"
  return {
    version: vcc ? VCC_SETUPTOOL_VERSION : SETUPTOOL_VERSION,
    family,
    controllerType,
    axisCount: Number(attr(head, "Axis")) || 3,
    ip: uintToIpv4(num(keys, "控制器IP地址", 2147483657)),
    gateway: uintToIpv4(num(keys, "控制器网关地址", 2147483649)),
    mask: uintToIpv4(num(keys, "控制器子网掩码", 4294901760)),
    port: num(keys, "控制器通讯端口", 10000),
    retractMm: num(keys, "回退距离", vcc ? 2 : 3),
    retractSpeed: num(keys, "回退速度", vcc ? 40 : 10),
    searchMm: num(keys, "搜索距离默认值", vcc ? 20 : 2),
    approachMm: num(keys, "默认接近距离", 3),
    measureSpeed: num(keys, "默认测量速度", 5),
    positionSpeed: num(keys, "默认定位速度", 150),
    temperatureEnabledRaw: num(keys, "温度补偿使能", 0),
    temperatureChannels: channels,
    scaleX: num(keys, "X轴编码器分辨率", 0.0001),
    scaleY: num(keys, "Y轴编码器分辨率", 0.0001),
    scaleZ: num(keys, "Z轴编码器分辨率", 0.0001),
    ...(softLimits
      ? {
          softLimits,
          travel: {
            x: softLimits.max.x - softLimits.min.x,
            y: softLimits.max.y - softLimits.min.y,
            z: softLimits.max.z - softLimits.min.z,
          },
        }
      : {}),
  }
}

export function setupToolSummary(p: SetupToolProfile): string {
  const travel = p.travel ? ` · 行程 ${p.travel.x.toFixed(1)}×${p.travel.y.toFixed(1)}×${p.travel.z.toFixed(1)} mm` : ""
  return `${p.controllerType} ${p.version} · ${p.ip}:${p.port} · 回退 ${p.retractMm} mm @ ${p.retractSpeed} mm/s · 搜索 ${p.searchMm} mm${travel}`
}
