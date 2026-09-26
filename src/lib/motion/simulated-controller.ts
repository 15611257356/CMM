import { add, scale } from "@/lib/math/linalg"
import { cloneVec, dist, lerpVec, MACHINE, type Axis, type Vec3 } from "@/lib/geom"
import {
  MotionError,
  type MotionController,
  type MotionMode,
  type MotionSnapshot,
  type SoftLimits,
} from "@/lib/motion/types"

type JogCommand = { axis: Axis; direction: 1 | -1; speed: number }
type MoveCommand = {
  from: Vec3
  to: Vec3
  startedAt: number
  durationMs: number
  resolve: () => void
  reject: (error: MotionError) => void
}

export type TouchSensor = (
  start: Vec3,
  direction: Vec3,
  maxTravel: number
) => { kind: "hit"; center: Vec3 } | { kind: "miss" } | { kind: "collision" }

/** 五次多项式 S 曲线：速度、加速度在起止点均为 0，避免启停冲击。 */
function sCurve(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return x * x * x * (x * (x * 6 - 15) + 10)
}

export class SimulatedMotionController implements MotionController {
  private position: Vec3 = cloneVec(MACHINE.home)
  private estopActive = false
  private homed = false
  private overtravel: Axis | null = null
  private mode: MotionMode = "idle"
  private limits: SoftLimits = {
    min: { x: MACHINE.xMin, y: MACHINE.yMin, z: MACHINE.zMin },
    max: { x: MACHINE.xMax, y: MACHINE.yMax, z: MACHINE.zMax },
  }
  private listeners = new Set<(snapshot: MotionSnapshot) => void>()
  private raf = 0
  private lastTick = 0
  private jogCommand: JogCommand | null = null
  private move: MoveCommand | null = null
  private speedMmPerSec = 80
  private sensor: TouchSensor | null = null

  setTouchSensor(sensor: TouchSensor) {
    this.sensor = sensor
  }

  getSnapshot(): MotionSnapshot {
    return {
      position: cloneVec(this.position),
      estop: this.estopActive,
      homed: this.homed,
      overtravel: this.overtravel,
      moving: this.mode !== "idle",
      mode: this.mode,
      connected: true,
      backend: "simulation",
      speedMmPerSec: this.speedMmPerSec,
    }
  }

  subscribe(listener: (snapshot: MotionSnapshot) => void): () => void {
    this.listeners.add(listener)
    listener(this.getSnapshot())
    this.ensureLoop()
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) this.stopLoop()
    }
  }

  jog(axis: Axis, direction: 1 | -1, speedMmPerSec: number): void {
    this.assertNotEstop()
    this.cancelMove(new MotionError("点动打断当前运动", "busy"))
    this.overtravel = null
    this.speedMmPerSec = speedMmPerSec
    this.jogCommand = { axis, direction, speed: speedMmPerSec }
    this.mode = "jog"
    this.ensureLoop()
    this.emit()
  }

  stopJog(): void {
    if (!this.jogCommand) return
    this.jogCommand = null
    if (!this.move) this.mode = "idle"
    this.emit()
  }

  moveTo(target: Vec3, speedMmPerSec: number): Promise<void> {
    try {
      this.assertNotEstop()
      this.assertHomed()
      this.assertWithinLimits(target)
    } catch (error) {
      return Promise.reject(error)
    }
    return this.startMove(target, speedMmPerSec, "move")
  }

  async probe(direction: Vec3, maxTravel: number, speedMmPerSec: number): Promise<Vec3 | null> {
    this.assertNotEstop()
    this.assertHomed()
    if (!this.sensor) throw new MotionError("仿真测头未接入", "disconnected")
    const start = cloneVec(this.position)
    const touch = this.sensor(start, direction, maxTravel)
    if (touch.kind === "collision") {
      this.estop()
      throw new MotionError("测针起点已与工件干涉，已急停", "collision")
    }
    const end = touch.kind === "hit" ? touch.center : add(start, scale(direction, maxTravel))
    this.assertWithinLimits(end)
    await this.startMove(end, speedMmPerSec, "probe")
    return touch.kind === "hit" ? cloneVec(touch.center) : null
  }

  home(speedMmPerSec: number): Promise<void> {
    try {
      this.assertNotEstop()
    } catch (error) {
      return Promise.reject(error)
    }
    const up = { ...this.position, z: MACHINE.home.z }
    return this.startMove(up, speedMmPerSec, "home")
      .then(() => this.startMove(MACHINE.home, speedMmPerSec, "home"))
      .then(() => {
        this.homed = true
        this.mode = "idle"
        this.emit()
      })
  }

  estop(): void {
    this.estopActive = true
    this.homed = false
    this.jogCommand = null
    this.cancelMove(new MotionError("急停已触发，运动已切断", "estop"))
    this.mode = "idle"
    this.emit()
  }

  resetEstop(): void {
    this.estopActive = false
    this.overtravel = null
    this.emit()
  }

  setSoftLimits(limits: SoftLimits): void {
    this.limits = { min: cloneVec(limits.min), max: cloneVec(limits.max) }
  }

  private startMove(target: Vec3, speedMmPerSec: number, mode: MotionMode): Promise<void> {
    if (this.move) return Promise.reject(new MotionError("运动控制器忙", "busy"))
    const to = cloneVec(target)
    const travel = dist(this.position, to)
    this.overtravel = null
    this.speedMmPerSec = speedMmPerSec
    if (travel < 0.0005) {
      this.position = to
      this.emit()
      return Promise.resolve()
    }
    const durationMs = Math.max(60, (travel / speedMmPerSec) * 1000 * 1.25)
    return new Promise((resolve, reject) => {
      this.move = { from: cloneVec(this.position), to, startedAt: performance.now(), durationMs, resolve, reject }
      this.mode = mode
      this.ensureLoop()
      this.emit()
    })
  }

  private assertNotEstop(): void {
    if (this.estopActive) throw new MotionError("急停锁定中，请先复位", "estop")
  }

  private assertHomed(): void {
    if (!this.homed) throw new MotionError("未回零：上电或急停后必须先回零", "not-homed")
  }

  private assertWithinLimits(target: Vec3): void {
    for (const axis of ["x", "y", "z"] as Axis[]) {
      if (target[axis] < this.limits.min[axis] - 1e-9 || target[axis] > this.limits.max[axis] + 1e-9) {
        this.overtravel = axis
        this.emit()
        throw new MotionError(
          `${axis.toUpperCase()} 轴目标 ${target[axis].toFixed(3)} 超出软限位 [${this.limits.min[axis]}, ${this.limits.max[axis]}]，已拒绝执行`,
          "overtravel"
        )
      }
    }
  }

  private applyAxisStep(axis: Axis, delta: number): void {
    const next = this.position[axis] + delta
    const min = this.limits.min[axis]
    const max = this.limits.max[axis]
    if (next < min || next > max) {
      this.position[axis] = Math.min(max, Math.max(min, next))
      this.overtravel = axis
      this.jogCommand = null
      this.mode = "idle"
      return
    }
    this.position[axis] = next
  }

  private cancelMove(error: MotionError): void {
    if (!this.move) return
    const current = this.move
    this.move = null
    current.reject(error)
  }

  private ensureLoop(): void {
    if (this.raf || typeof requestAnimationFrame === "undefined") return
    this.lastTick = performance.now()
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick)
      const dt = Math.min(0.05, (now - this.lastTick) / 1000)
      this.lastTick = now
      if (this.estopActive) return

      if (this.jogCommand) {
        this.applyAxisStep(this.jogCommand.axis, this.jogCommand.direction * this.jogCommand.speed * dt)
        this.emit()
      }

      if (this.move) {
        const u = sCurve((now - this.move.startedAt) / this.move.durationMs)
        this.position = lerpVec(this.move.from, this.move.to, u)
        if (u >= 1) {
          this.position = cloneVec(this.move.to)
          const done = this.move
          this.move = null
          this.mode = this.jogCommand ? "jog" : "idle"
          done.resolve()
        }
        this.emit()
      }
    }
    this.raf = requestAnimationFrame(tick)
  }

  private stopLoop(): void {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  private emit(): void {
    const snapshot = this.getSnapshot()
    this.listeners.forEach((listener) => listener(snapshot))
  }
}
