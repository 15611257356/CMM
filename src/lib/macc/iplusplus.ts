/**
 * IPPServer 基于 I++ DME 1.7，与 SuperDMIS 等测量软件通讯（TCP，默认端口 1294）。
 *
 * 每行一条消息：5 位标签 + 空格 + 内容 + CRLF。
 *   客户端：00012 GoTo(X(10),Y(20),Z(30))
 *   服务器：00012 &              已收到
 *           00012 # X(..), Y(..)  数据
 *           00012 %              执行完成
 *           00012 ! Error(...)    出错
 * 标签以 E 开头的是事件通道（急停、运动中位置上报、AbortE）。
 */
export type Vec3Like = { x: number; y: number; z: number }

export const IPP_DEFAULT_PORT = 1294

export function ippTag(n: number, event = false): string {
  const body = String(((n - 1) % 9999) + 1).padStart(4, "0")
  return event ? `E${body}` : `0${body}`
}

export function encodeIpp(tag: string, command: string): string {
  return `${tag} ${command.replace(/\r?\n$/, "")}\r\n`
}

export type IppReplyKind = "ack" | "data" | "done" | "error" | "event"

export type IppReply = { tag: string; kind: IppReplyKind; body: string }

export function parseIppLine(line: string): IppReply | null {
  const m = /^\s*([0-9E]\d{4})\s+([&#%!])\s?(.*)$/.exec(line)
  if (!m) return null
  const [, tag, mark, body] = m
  const kind: IppReplyKind =
    mark === "&" ? "ack" : mark === "%" ? "done" : mark === "!" ? "error" : tag.startsWith("E") ? "event" : "data"
  return { tag, kind, body: body.trim() }
}

/** 解析 `X(1.2), Y(3.4), Z(5.6), IJK(0,0,1)` 这类数据行。 */
export function parseIppValues(body: string): Record<string, number[]> {
  const out: Record<string, number[]> = {}
  const re = /([A-Za-z.]+)\(([^()]*)\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) {
    const values = m[2]
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((v) => Number.isFinite(v))
    out[m[1]] = values
  }
  return out
}

export function ippXyz(body: string): Vec3Like | null {
  const v = parseIppValues(body)
  const x = v.X?.[0]
  const y = v.Y?.[0]
  const z = v.Z?.[0]
  return [x, y, z].every((n) => typeof n === "number" && Number.isFinite(n)) ? { x: x!, y: y!, z: z! } : null
}

/** `Error(3, 1003, "GoTo", "Emergency stop")` → 严重度、代码、文本。 */
export function parseIppError(body: string): { severity: number; code: string; text: string } {
  const m = /Error\(\s*(\d+)\s*,\s*(\d+)\s*,\s*"?([^",]*)"?\s*,\s*"?([^"]*)"?\s*\)/.exec(body)
  if (!m) return { severity: 3, code: "", text: body }
  return { severity: Number(m[1]), code: m[2], text: m[4] || m[3] }
}

function fmt(n: number): string {
  return n.toFixed(4)
}

export function ippGoTo(p: Vec3Like): string {
  return `GoTo(X(${fmt(p.x)}),Y(${fmt(p.y)}),Z(${fmt(p.z)}))`
}

/** 名义表面点 + 表面外法向（测针沿 -IJK 方向触测）。 */
export function ippPtMeas(p: Vec3Like, ijk: Vec3Like): string {
  return `PtMeas(X(${fmt(p.x)}),Y(${fmt(p.y)}),Z(${fmt(p.z)}),IJK(${fmt(ijk.x)},${fmt(ijk.y)},${fmt(ijk.z)}))`
}

export function ippSetGoToSpeed(mmPerSec: number): string {
  return `SetProp(Tool.GoToPar.Speed(${fmt(mmPerSec)}))`
}

export function ippSetPtMeasPar(p: { speed: number; approach: number; search: number; retract: number }): string {
  return `SetProp(Tool.PtMeasPar.Speed(${fmt(p.speed)}),Tool.PtMeasPar.Approach(${fmt(p.approach)}),Tool.PtMeasPar.Search(${fmt(p.search)}),Tool.PtMeasPar.Retract(${fmt(p.retract)}))`
}

export const ippHome = () => "Home()"
export const ippIsHomed = () => "IsHomed()"
export const ippStartSession = () => "StartSession()"
export const ippEndSession = () => "EndSession()"
export const ippClearAllErrors = () => "ClearAllErrors()"
export const ippGetPosition = () => "Get(X(),Y(),Z())"
export const ippAbort = () => "AbortE()"
export const ippDisableUser = () => "DisableUser()"
export const ippEnableUser = () => "EnableUser()"
export const ippOnMoveReport = (seconds: number) => `OnMoveReportE(Time(${seconds.toFixed(2)}),X(),Y(),Z())`
export const ippGetTool = () => "GetProp(Tool.Name())"
