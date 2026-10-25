/**
 * SetupTool V3.33（MACC 调试软件）Config/config.xml。
 * 出厂包：MACC3000，以太网端口 10000，测量回退 3 mm / 10 mm/s，默认搜索 2 mm。
 */
export const SETUPTOOL_VERSION = "V3.33"

export type SetupToolProfile = {
  version: string
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
    if (name) map.set(name, attr(m[1], "Value") ?? "")
  }
  return map
}

function num(map: Map<string, string>, name: string, fallback: number): number {
  const v = Number(map.get(name))
  return Number.isFinite(v) ? v : fallback
}

/** SetupTool 把 IPv4 存成大端 uint32。本包出厂 2147483657 → 128.0.0.9 */
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
  const channels = Array.from({ length: 16 }, (_, i) => num(keys, `温度采集通道${i + 1}`, 0))
  return {
    version: SETUPTOOL_VERSION,
    controllerType: attr(head, "ControllerType") || "MACC",
    axisCount: Number(attr(head, "Axis")) || 3,
    ip: uintToIpv4(num(keys, "控制器IP地址", 2147483657)),
    gateway: uintToIpv4(num(keys, "控制器网关地址", 2147483649)),
    mask: uintToIpv4(num(keys, "控制器子网掩码", 4294901760)),
    port: num(keys, "控制器通讯端口", 10000),
    retractMm: num(keys, "回退距离", 3),
    retractSpeed: num(keys, "回退速度", 10),
    searchMm: num(keys, "搜索距离默认值", 2),
    approachMm: num(keys, "默认接近距离", 3),
    measureSpeed: num(keys, "默认测量速度", 5),
    positionSpeed: num(keys, "默认定位速度", 150),
    temperatureEnabledRaw: num(keys, "温度补偿使能", 0),
    temperatureChannels: channels,
    scaleX: num(keys, "X轴编码器分辨率", 0.0001),
    scaleY: num(keys, "Y轴编码器分辨率", 0.0001),
    scaleZ: num(keys, "Z轴编码器分辨率", 0.0001),
  }
}

export function setupToolSummary(p: SetupToolProfile): string {
  return `${p.controllerType} ${p.version} · ${p.ip}:${p.port} · 回退 ${p.retractMm} mm @ ${p.retractSpeed} mm/s · 搜索 ${p.searchMm} mm`
}
