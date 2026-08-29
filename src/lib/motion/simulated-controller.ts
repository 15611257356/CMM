import { cloneVec, dist, easeInOut, lerpVec, MACHINE, type Axis, type Vec3 } from "@/lib/geom"
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

export class SimulatedMotionController implements MotionController {
  private position: Vec3 = cloneVec(MACHINE.home)
  private estopActive = false
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

  getSnapshot(): MotionSnapshot {
    return {
      position: cloneVec(this.position),
      estop: this.estopActive,
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
    this.assertSafe()
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
    this.assertSafe()
    if (this.move) {
      return Promise.reject(new MotionError("运动控制器忙", "busy"))
    }
    const to = this.clampTarget(target)
    const travel = dist(this.position, to)
    if (travel < 0.001) {
      this.position = cloneVec(to)
      this.emit()
      return Promise.resolve()
    }
    this.overtravel = null
    this.speedMmPerSec = speedMmPerSec
    const durationMs = Math.max(80, (travel / speedMmPerSec) * 1000)
    return new Promise((resolve, reject) => {
      this.move = {
        from: cloneVec(this.position),
        to,
        startedAt: performance.now(),
        durationMs,
        resolve,
        reject,
      }
      this.mode = "move"
      this.ensureLoop()
      this.emit()
    })
  }

  home(speedMmPerSec: number): Promise<void> {
    this.assertSafe()
    this.mode = "home"
    this.emit()
    return this.moveTo(MACHINE.home, speedMmPerSec).finally(() => {
      if (!this.estopActive) this.mode = "idle"
      this.emit()
    })
  }

  estop(): void {
    this.estopActive = true
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
    this.limits = {
      min: cloneVec(limits.min),
      max: cloneVec(limits.max),
    }
  }

  private assertSafe(): void {
    if (this.estopActive) {
      throw new MotionError("急停锁定中，请先复位", "estop")
    }
  }

  private clampTarget(target: Vec3): Vec3 {
    const next = cloneVec(target)
    const axes: Axis[] = ["x", "y", "z"]
    for (const axis of axes) {
      if (next[axis] < this.limits.min[axis] || next[axis] > this.limits.max[axis]) {
        next[axis] = Math.min(this.limits.max[axis], Math.max(this.limits.min[axis], next[axis]))
        this.overtravel = axis
      }
    }
    return next
  }

  private applyAxisStep(axis: Axis, delta: number): boolean {
    const next = this.position[axis] + delta
    const min = this.limits.min[axis]
    const max = this.limits.max[axis]
    if (next < min || next > max) {
      this.position[axis] = Math.min(max, Math.max(min, next))
      this.overtravel = axis
      this.jogCommand = null
      this.mode = "idle"
      return false
    }
    this.position[axis] = next
    return true
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
        const u = easeInOut((now - this.move.startedAt) / this.move.durationMs)
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
