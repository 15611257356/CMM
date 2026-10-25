import { cloneVec, MACHINE, type Axis, type Vec3 } from "@/lib/geom"
import { add, scale } from "@/lib/math/linalg"
import {
  encodeIpp,
  ippAbort,
  ippClearAllErrors,
  ippDisableUser,
  ippEnableUser,
  ippEndSession,
  ippGetPosition,
  ippGoTo,
  ippHome,
  ippIsHomed,
  ippOnMoveReport,
  ippPtMeas,
  ippSetGoToSpeed,
  ippSetPtMeasPar,
  ippStartSession,
  ippTag,
  ippXyz,
  parseIppError,
  parseIppLine,
  parseIppValues,
} from "@/lib/macc/iplusplus"
import { MotionError, type MotionController, type MotionSnapshot, type SoftLimits } from "@/lib/motion/types"

/** 浏览器不能直接开 TCP，经本机中继（tools/ipp-relay.mjs）转到 IPPServer:1294。 */
export const DEFAULT_IPP_RELAY = "ws://127.0.0.1:17653/ipp"

export type SocketLike = {
  readyState: number
  send(data: string): void
  close(): void
  onopen: ((ev: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: ((ev: unknown) => void) | null
  onerror: ((ev: unknown) => void) | null
}

export type IppStatus = {
  connected: boolean
  url: string
  homed: boolean
  lastError: string
  /** 最近 40 条收发记录，便于和 IPPServer「通讯记录」对照。 */
  traffic: string[]
}

type Pending = { resolve: (data: string[]) => void; reject: (e: Error) => void; data: string[]; command: string }

const OPEN = 1

function missLike(text: string): boolean {
  return /not\s*found|no\s*(touch|contact|hit)|未触发|未找到|搜索失败|search/i.test(text)
}

export class IppMotionController implements MotionController {
  private ws: SocketLike | null = null
  private buffer = ""
  private nextTag = 1
  private pending = new Map<string, Pending>()
  private listeners = new Set<(s: MotionSnapshot) => void>()
  private statusListeners = new Set<(s: IppStatus) => void>()
  private position: Vec3 = cloneVec(MACHINE.home)
  /** 真机坐标是控制器坐标（VCC3500 出厂 X −300…4.5），未导入 SetupTool 配置前只靠控制柜自己的软限位。 */
  private limits: SoftLimits = {
    min: { x: -Infinity, y: -Infinity, z: -Infinity },
    max: { x: Infinity, y: Infinity, z: Infinity },
  }
  private status: IppStatus = { connected: false, url: DEFAULT_IPP_RELAY, homed: false, lastError: "", traffic: [] }
  private estopActive = false
  private mode: MotionSnapshot["mode"] = "idle"
  private goToSpeed = 0
  private tipRadius = 2
  /** I++ PtMeas 返回的是经测针半径补偿后的表面点（IPPServer 用已校验测针）。 */
  private returnsSurfacePoint = true

  constructor(private readonly socketFactory: (url: string) => SocketLike = (url) => new WebSocket(url) as unknown as SocketLike) {}

  setTipRadius(r: number) {
    if (r > 0) this.tipRadius = r
  }

  setReturnsSurfacePoint(value: boolean) {
    this.returnsSurfacePoint = value
  }

  getStatus(): IppStatus {
    return { ...this.status, traffic: [...this.status.traffic] }
  }

  subscribeStatus(listener: (s: IppStatus) => void): () => void {
    this.statusListeners.add(listener)
    listener(this.getStatus())
    return () => this.statusListeners.delete(listener)
  }

  getSnapshot(): MotionSnapshot {
    return {
      position: cloneVec(this.position),
      estop: this.estopActive,
      homed: this.status.homed && !this.estopActive,
      overtravel: null,
      moving: this.mode !== "idle",
      mode: this.mode,
      connected: this.status.connected,
      backend: "hardware",
      speedMmPerSec: this.goToSpeed,
    }
  }

  subscribe(listener: (s: MotionSnapshot) => void): () => void {
    this.listeners.add(listener)
    listener(this.getSnapshot())
    return () => this.listeners.delete(listener)
  }

  async connect(url = DEFAULT_IPP_RELAY): Promise<void> {
    this.disconnect()
    this.status = { ...this.status, url, connected: false, lastError: "" }
    await new Promise<void>((resolve, reject) => {
      const ws = this.socketFactory(url)
      this.ws = ws
      const timer = setTimeout(() => {
        ws.close()
        reject(new MotionError("连接 I++ 中继超时。请在工控机运行 tools/ipp-relay.mjs，并确认 IPPServer 已打开", "disconnected"))
      }, 4000)
      ws.onopen = () => {
        clearTimeout(timer)
        resolve()
      }
      ws.onerror = () => {
        clearTimeout(timer)
        reject(new MotionError(`无法连接 I++ 中继 ${url}`, "disconnected"))
      }
      ws.onmessage = (ev) => this.onText(String(ev.data))
      ws.onclose = () => {
        this.ws = null
        this.status.connected = false
        this.flushPending("I++ 连接已断开")
        this.emit()
      }
    })
    await this.command(ippStartSession())
    await this.command(ippClearAllErrors())
    await this.command(ippOnMoveReport(0.1)).catch(() => undefined)
    this.status.connected = true
    await this.refreshHomed()
    await this.refreshPosition()
    this.emit()
  }

  disconnect(): void {
    if (this.ws && this.ws.readyState === OPEN) {
      try {
        this.ws.send(encodeIpp(ippTag(this.nextTag++), ippEndSession()))
      } catch {
        /* ignore */
      }
    }
    this.ws?.close()
    this.ws = null
    this.status.connected = false
    this.flushPending("I++ 连接已断开")
    this.emit()
  }

  jog(): void {
    void this.command(ippEnableUser()).catch(() => undefined)
    throw new MotionError("I++ 通道没有点动指令：已允许控制柜摇杆（EnableUser），请用摇杆点动", "busy")
  }

  stopJog(): void {
    if (this.status.connected) void this.command(ippDisableUser()).catch(() => undefined)
  }

  async moveTo(target: Vec3, speedMmPerSec: number): Promise<void> {
    this.assertReady()
    this.assertInside(target)
    this.mode = "move"
    this.emit()
    try {
      if (Math.abs(speedMmPerSec - this.goToSpeed) > 1e-6) {
        await this.command(ippSetGoToSpeed(speedMmPerSec))
        this.goToSpeed = speedMmPerSec
      }
      await this.command(ippGoTo(target), 120000)
      this.position = cloneVec(target)
    } finally {
      this.mode = "idle"
      this.emit()
    }
  }

  async probe(direction: Vec3, maxTravel: number, speedMmPerSec: number, expected?: number): Promise<Vec3 | null> {
    this.assertReady()
    const approach = expected ?? Math.min(3, maxTravel / 2)
    const surface = add(this.position, scale(direction, this.tipRadius + approach))
    const ijk = scale(direction, -1)
    this.mode = "probe"
    this.emit()
    try {
      await this.command(
        ippSetPtMeasPar({ speed: speedMmPerSec, approach, search: Math.max(0.5, maxTravel - approach), retract: approach })
      )
      const data = await this.command(ippPtMeas(surface, ijk), 60000)
      const q = data.map(ippXyz).find(Boolean)
      if (!q) throw new MotionError("PtMeas 没有返回测点坐标", "busy")
      const center = this.returnsSurfacePoint ? add(q, scale(direction, -this.tipRadius)) : q
      await this.refreshPosition()
      return center
    } catch (error) {
      if (error instanceof MotionError && missLike(error.message)) return null
      throw error
    } finally {
      this.mode = "idle"
      this.emit()
    }
  }

  async home(): Promise<void> {
    this.assertConnected()
    if (this.estopActive) throw new MotionError("急停锁定中，请先复位", "estop")
    this.mode = "home"
    this.emit()
    try {
      await this.command(ippHome(), 300000)
      this.status.homed = true
      await this.refreshPosition()
    } finally {
      this.mode = "idle"
      this.emit()
    }
  }

  estop(): void {
    this.estopActive = true
    this.status.homed = false
    if (this.ws && this.ws.readyState === OPEN) this.send(ippTag(this.nextTag++, true), ippAbort())
    this.flushPending("已发送 AbortE，运动中止")
    this.mode = "idle"
    this.emit()
  }

  resetEstop(): void {
    this.estopActive = false
    if (this.status.connected) void this.command(ippClearAllErrors()).catch(() => undefined)
    this.emit()
  }

  setSoftLimits(limits: SoftLimits): void {
    this.limits = { min: cloneVec(limits.min), max: cloneVec(limits.max) }
  }

  private async refreshHomed(): Promise<void> {
    try {
      const data = await this.command(ippIsHomed())
      const v = data.map((d) => parseIppValues(d).IsHomed?.[0]).find((x) => x !== undefined)
      this.status.homed = v === 1
    } catch {
      this.status.homed = false
    }
  }

  private async refreshPosition(): Promise<void> {
    const data = await this.command(ippGetPosition())
    const p = data.map(ippXyz).find(Boolean)
    if (p) this.position = p
  }

  private send(tag: string, command: string) {
    const line = encodeIpp(tag, command)
    this.ws!.send(line)
    this.trace(`→ ${line.trim()}`)
  }

  private command(command: string, timeoutMs = 10000): Promise<string[]> {
    if (!this.ws || this.ws.readyState !== OPEN) return Promise.reject(new MotionError("I++ 中继未连接", "disconnected"))
    const tag = ippTag(this.nextTag++)
    return new Promise<string[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(tag)) reject(new MotionError(`${command.split("(")[0]} 超时`, "busy"))
      }, timeoutMs)
      this.pending.set(tag, {
        command,
        data: [],
        resolve: (d) => {
          clearTimeout(timer)
          resolve(d)
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        },
      })
      this.send(tag, command)
    })
  }

  private onText(text: string) {
    this.buffer += text
    const lines = this.buffer.split(/\r?\n/)
    this.buffer = lines.pop() ?? ""
    for (const line of lines) {
      if (!line.trim()) continue
      const reply = parseIppLine(line)
      // OnMoveReport 每 0.1 s 一条，记进通讯记录会把指令应答全冲掉
      if (!(reply?.tag.startsWith("E") && reply.kind === "data")) this.trace(`← ${line.trim()}`)
      if (!reply) continue
      if (reply.tag.startsWith("E")) {
        if (reply.kind === "error") {
          const err = parseIppError(reply.body)
          this.status.lastError = err.text
          if (/emergency|急停|e-?stop/i.test(err.text)) {
            this.estopActive = true
            this.status.homed = false
            this.flushPending(`急停：${err.text}`)
          }
        } else {
          const p = ippXyz(reply.body)
          if (p) this.position = p
        }
        this.emit()
        continue
      }
      const wait = this.pending.get(reply.tag)
      if (!wait) continue
      if (reply.kind === "data") wait.data.push(reply.body)
      else if (reply.kind === "done") {
        this.pending.delete(reply.tag)
        wait.resolve(wait.data)
      } else if (reply.kind === "error") {
        const err = parseIppError(reply.body)
        this.status.lastError = err.text
        if (err.severity >= 2) {
          this.pending.delete(reply.tag)
          const code = /emergency|急停/i.test(err.text) ? "estop" : /homed|回零/i.test(err.text) ? "not-homed" : "busy"
          wait.reject(new MotionError(`${wait.command.split("(")[0]}：${err.text}`, code))
        }
      }
    }
  }

  private trace(line: string) {
    this.status.traffic = [...this.status.traffic, line].slice(-40)
    this.statusListeners.forEach((l) => l(this.getStatus()))
  }

  private flushPending(reason: string) {
    for (const [, p] of this.pending) p.reject(new MotionError(reason, "estop"))
    this.pending.clear()
  }

  private assertConnected() {
    if (!this.status.connected) throw new MotionError("I++ 未连接。请先打开 IPPServer 与本机中继", "disconnected")
  }

  private assertReady() {
    this.assertConnected()
    if (this.estopActive) throw new MotionError("急停锁定中，请先复位", "estop")
  }

  private assertInside(target: Vec3) {
    for (const axis of ["x", "y", "z"] as Axis[]) {
      if (target[axis] < this.limits.min[axis] - 1e-9 || target[axis] > this.limits.max[axis] + 1e-9) {
        throw new MotionError(`${axis.toUpperCase()} 目标 ${target[axis].toFixed(3)} 超出软限位，已拒绝下发`, "overtravel")
      }
    }
  }

  private emit() {
    const snap = this.getSnapshot()
    this.listeners.forEach((l) => l(snap))
    this.statusListeners.forEach((l) => l(this.getStatus()))
  }
}
