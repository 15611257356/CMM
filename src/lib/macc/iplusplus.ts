/**
 * IPPServer 基于 I++ DME 1.7，与 SuperDMIS 等测量软件通讯。
 * 帧格式：5 位十进制长度（含命令与 CRLF）+ 命令 + CRLF。
 */
export function encodeIpp(command: string): string {
  const body = command.replace(/\r?\n$/, "") + "\r\n"
  return String(body.length).padStart(5, "0") + body
}

export function decodeIpp(frame: string): string {
  const raw = frame.replace(/^\d{5}/, "").replace(/\r?\n$/, "")
  return raw
}

export function ippGoTo(p: { x: number; y: number; z: number }): string {
  return `GoTo(X(${fmt(p.x)}),Y(${fmt(p.y)}),Z(${fmt(p.z)}))`
}

export function ippPtMeas(
  p: { x: number; y: number; z: number },
  ijk: { x: number; y: number; z: number }
): string {
  return `PtMeas(X(${fmt(p.x)}),Y(${fmt(p.y)}),Z(${fmt(p.z)}),IJK(${fmt(ijk.x)},${fmt(ijk.y)},${fmt(ijk.z)}))`
}

export function ippSetSpeed(mmPerSec: number): string {
  return `SetProp(Speed(${fmt(mmPerSec)}))`
}

export function ippHome(): string {
  return "Home()"
}

export function ippStartSession(): string {
  return "StartSession()"
}

export function ippEndSession(): string {
  return "EndSession()"
}

export function ippAbort(): string {
  return "AbortE()"
}

export function ippDisableJoystick(): string {
  return "DisableUser()"
}

export function ippEnableJoystick(): string {
  return "EnableUser()"
}

function fmt(n: number): string {
  return n.toFixed(4)
}
