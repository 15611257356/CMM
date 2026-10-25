import { add, scale } from "@/lib/math/linalg"
import { cloneVec, MACHINE, type Axis, type Vec3 } from "@/lib/geom"
import { maccErrorMessage, maccOk } from "@/lib/macc/errors"
import {
  AXIS_X,
  AXIS_Y,
  AXIS_Z,
  firstOvertravel,
  parseAxisHomed,
  parseMotionStatus,
} from "@/lib/macc/status"
import {
  DEFAULT_MACC_BRIDGE,
  axisIndex,
  emptyTelemetry,
  xyzArray,
  type MaccMethod,
  type MaccRequest,
  type MaccResponse,
  type MaccTelemetry,
} from "@/lib/macc/protocol"
import {
  MotionError,
  type MotionController,
  type MotionSnapshot,
  type SoftLimits,
} from "@/lib/motion/types"

const POLL_MS = 80
const TOUCH_TIMEOUT_MS = 30000

export class MaccBridgeController implements MotionController {
  private ws: WebSocket | null = null
  private nextId = 1
  private pending = new Map<number, { resolve: (r: MaccResponse) => void; reject: (e: Error) => void }>()
  private listeners = new Set<(snapshot: MotionSnapshot) => void>()
  private telemetryListeners = new Set<(t: MaccTelemetry) => void>()
  private position: Vec3 = cloneVec(MACHINE.home)
  private limits: SoftLimits = {
    min: { x: MACHINE.xMin, y: MACHINE.yMin, z: MACHINE.zMin },
    max: { x: MACHINE.xMax, y: MACHINE.yMax, z: MACHINE.zMax },
  }
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private telemetry: MaccTelemetry = emptyTelemetry()
  private jogging = false
  private mode: MotionSnapshot["mode"] = "idle"

  getTelemetry(): MaccTelemetry {
    return { ...this.telemetry }
  }

  subscribeTelemetry(listener: (t: MaccTelemetry) => void): () => void {
    this.telemetryListeners.add(listener)
    listener(this.getTelemetry())
    return () => this.telemetryListeners.delete(listener)
  }

  getSnapshot(): MotionSnapshot {
    const motion = parseMotionStatus(this.telemetry.motionStatus)
    return {
      position: cloneVec(this.position),
      estop: motion.estop,
      homed: parseAxisHomed(this.telemetry.axisStatus),
      overtravel: firstOvertravel(this.telemetry.axisStatus),
      moving: !motion.allStopped || this.jogging,
      mode: motion.touching ? "probe" : this.jogging ? "jog" : motion.allStopped ? "idle" : this.mode,
      connected: this.telemetry.connected,
      backend: "hardware",
      speedMmPerSec: 0,
    }
  }

  subscribe(listener: (snapshot: MotionSnapshot) => void): () => void {
    this.listeners.add(listener)
    listener(this.getSnapshot())
    return () => this.listeners.delete(listener)
  }

  async connect(url = DEFAULT_MACC_BRIDGE): Promise<void> {
    if (typeof WebSocket === "undefined") throw new MotionError("当前环境没有 WebSocket", "disconnected")
    this.disconnect()
    this.telemetry = emptyTelemetry(url)
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url)
      this.ws = ws
      const timer = setTimeout(() => {
        ws.close()
        reject(new MotionError("连接 MACC 桥接超时。请在工控机运行加载 MACC.dll 的本地服务", "disconnected"))
      }, 4000)
      ws.onopen = () => {
        clearTimeout(timer)
        resolve()
      }
      ws.onerror = () => {
        clearTimeout(timer)
        reject(new MotionError("无法连接 MACC 桥接 " + url, "disconnected"))
      }
      ws.onmessage = (ev) => this.onMessage(String(ev.data))
      ws.onclose = () => {
        this.ws = null
        this.stopPoll()
        this.telemetry.connected = false
        this.flushPending()
        this.emit()
      }
    })
    const init = await this.call("MACC_initial")
    if (!maccOk(init.code)) throw new MotionError(maccErrorMessage(init.code), init.code === 31 ? "disconnected" : "busy")
    this.telemetry.connected = true
    await this.refreshIdentity()
    this.startPoll()
    this.emit()
  }

  disconnect(): void {
    this.stopPoll()
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) void this.call("MACC_close")
    } catch {
      /* ignore */
    }
    this.ws?.close()
    this.ws = null
    this.telemetry.connected = false
    this.flushPending()
    this.emit()
  }

  jog(axis: Axis, direction: 1 | -1, speedMmPerSec: number): void {
    void this.jogAsync(axis, direction, speedMmPerSec)
  }

  private async jogAsync(axis: Axis, direction: 1 | -1, speedMmPerSec: number): Promise<void> {
    this.assertConnected()
    const i = axisIndex(axis)
    await this.ok("MACC_jog_start", [i])
    await this.ok("MACC_change_speed", [i, direction * Math.abs(speedMmPerSec)])
    this.jogging = true
    this.mode = "jog"
    this.emit()
  }

  stopJog(): void {
    if (!this.telemetry.connected) return
    void this.ok("MACC_jog_stop").finally(() => {
      this.jogging = false
      this.mode = "idle"
      this.emit()
    })
  }

  async moveTo(target: Vec3, speedMmPerSec: number): Promise<void> {
    this.assertConnected()
    this.assertNotEstop()
    this.assertInside(target)
    this.mode = "move"
    this.emit()
    await this.ok("MACC_disable_joystick")
    await this.ok("MACC_XYZ_move_to", [speedMmPerSec, xyzArray(target)])
    await this.waitUntil(() => parseMotionStatus(this.telemetry.motionStatus).allStopped)
    this.mode = "idle"
    this.emit()
  }

  async probe(direction: Vec3, maxTravel: number, speedMmPerSec: number): Promise<Vec3 | null> {
    this.assertConnected()
    this.assertNotEstop()
    const start = cloneVec(this.position)
    const target = add(start, scale(direction, Math.max(maxTravel, 0.01)))
    this.mode = "probe"
    this.emit()
    await this.ok("MACC_disable_joystick")
    await this.ok("MACC_enable_probe")
    await this.ok("MACC_set_retract_parameter", [Math.max(speedMmPerSec, 0.5), 2])
    await this.ok("MACC_touch_move", [speedMmPerSec, maxTravel, xyzArray(target), xyzArray(direction)])
    await this.waitUntil(() => {
      const m = parseMotionStatus(this.telemetry.motionStatus)
      return !m.touching && m.allStopped
    }, TOUCH_TIMEOUT_MS)
    const m = parseMotionStatus(this.telemetry.motionStatus)
    this.mode = "idle"
    if (m.touchFault) return null
    const cap = await this.call("MACC_get_probe_capture_position")
    if (!maccOk(cap.code) || !Array.isArray(cap.result)) return null
    const [x, y, z] = cap.result as number[]
    if (![x, y, z].every(Number.isFinite)) return null
    this.position = { x, y, z }
    this.emit()
    return cloneVec(this.position)
  }

  async home(): Promise<void> {
    this.assertConnected()
    this.assertNotEstop()
    this.mode = "home"
    this.emit()
    await this.ok("MACC_disable_joystick")
    for (const axis of [AXIS_Z, AXIS_X, AXIS_Y]) {
      await this.ok("MACC_go_home", [axis])
      await this.waitUntil(() => ((this.telemetry.axisStatus[axis] ?? 0) & 0x0800) !== 0)
    }
    this.mode = "idle"
    this.emit()
  }

  estop(): void {
    if (!this.telemetry.connected) return
    void this.ok("MACC_stop", [1])
    this.jogging = false
    this.mode = "idle"
    this.emit()
  }

  resetEstop(): void {
    if (!this.telemetry.connected) return
    void this.ok("MACC_clear_err")
  }

  setSoftLimits(limits: SoftLimits): void {
    this.limits = {
      min: { ...limits.min },
      max: { ...limits.max },
    }
  }

  async setTemperatureCompensation(enable: boolean): Promise<void> {
    await this.ok("MACC_temperature_compensation_enable", [enable])
    this.telemetry.temperatureComp = enable
    this.emitTelemetry()
  }

  async setMachineCompensation(enable: boolean, toolOffset: Vec3 = { x: 0, y: 0, z: 0 }): Promise<void> {
    await this.ok("MACC_machine_error_compensation", [enable, xyzArray(toolOffset)])
    this.telemetry.machineComp = enable
    this.emitTelemetry()
  }

  private async refreshIdentity(): Promise<void> {
    const serial = await this.call("MACC_get_serialno")
    if (typeof serial.result === "string") this.telemetry.serial = serial.result
    const fw = await this.call("MACC_get_firmware")
    if (Array.isArray(fw.result)) {
      this.telemetry.firmwareF = String(fw.result[0] ?? "")
      this.telemetry.firmwareD = String(fw.result[1] ?? "")
    }
  }

  private startPoll(): void {
    this.stopPoll()
    this.pollTimer = setInterval(() => {
      void this.poll()
    }, POLL_MS)
  }

  private stopPoll(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
  }

  private async poll(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    try {
      const pos = await this.call("MACC_get_position")
      if (Array.isArray(pos.result)) {
        const [x, y, z] = pos.result as number[]
        this.position = { x: x ?? 0, y: y ?? 0, z: z ?? 0 }
      }
      const motion = await this.call("MACC_get_motion_status")
      if (typeof motion.result === "number") this.telemetry.motionStatus = motion.result
      const axes = await this.call("MACC_get_axis_status")
      if (Array.isArray(axes.result)) this.telemetry.axisStatus = axes.result as number[]
      const probe = await this.call("MACC_get_probe_status")
      if (typeof probe.result === "number") this.telemetry.probeStatus = probe.result
      const temp = await this.call("MACC_get_part_temperature")
      if (typeof temp.result === "number") this.telemetry.partTempC = temp.result
      this.emit()
    } catch {
      /* 轮询失败不打断操作 */
    }
  }

  private async waitUntil(pred: () => boolean, timeoutMs = 20000): Promise<void> {
    const start = Date.now()
    while (!pred()) {
      if (Date.now() - start > timeoutMs) throw new MotionError("等待 MACC 运动结束超时", "busy")
      await this.poll()
      await new Promise((r) => setTimeout(r, POLL_MS))
    }
  }

  private async ok(method: MaccMethod, args: unknown[] = []): Promise<MaccResponse> {
    const res = await this.call(method, args)
    if (!maccOk(res.code)) {
      const motion = parseMotionStatus(this.telemetry.motionStatus)
      const code = motion.estop || res.code === 4416 ? "estop" : res.code === 4391 ? "not-homed" : res.code === 31 ? "disconnected" : "busy"
      throw new MotionError(maccErrorMessage(res.code), code)
    }
    return res
  }

  private call(method: MaccMethod, args: unknown[] = []): Promise<MaccResponse> {
    this.assertConnectedSocket()
    const id = this.nextId++
    const req: MaccRequest = { id, method, args }
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws!.send(JSON.stringify(req))
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new MotionError(`${method} 超时`, "busy"))
      }, 8000)
    })
  }

  private onMessage(text: string): void {
    try {
      const msg = JSON.parse(text) as MaccResponse
      const wait = this.pending.get(msg.id)
      if (!wait) return
      this.pending.delete(msg.id)
      wait.resolve(msg)
    } catch {
      /* ignore malformed */
    }
  }

  private flushPending(): void {
    for (const [, p] of this.pending) p.reject(new MotionError("MACC 连接已断开", "disconnected"))
    this.pending.clear()
  }

  private assertConnected(): void {
    if (!this.telemetry.connected) throw new MotionError("MACC 未连接。请先打开本机桥接（MACC.dll）", "disconnected")
  }

  private assertConnectedSocket(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new MotionError("MACC 桥接未连接", "disconnected")
  }

  private assertNotEstop(): void {
    if (parseMotionStatus(this.telemetry.motionStatus).estop) throw new MotionError("急停输入有效", "estop")
  }

  private assertInside(target: Vec3): void {
    const axes: Axis[] = ["x", "y", "z"]
    for (const axis of axes) {
      if (target[axis] < this.limits.min[axis] - 1e-9 || target[axis] > this.limits.max[axis] + 1e-9) {
        throw new MotionError(`${axis.toUpperCase()} 目标超出软限位`, "overtravel")
      }
    }
  }

  private emit(): void {
    const snap = this.getSnapshot()
    this.listeners.forEach((l) => l(snap))
    this.emitTelemetry()
  }

  private emitTelemetry(): void {
    const t = this.getTelemetry()
    this.telemetryListeners.forEach((l) => l(t))
  }
}

/** 兼容原 hardwareMotion 导出名：未连接时所有动作拒绝。 */
export { MaccBridgeController as HardwareMotionController }
