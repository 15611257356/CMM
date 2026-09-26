import type { Axis, Vec3 } from "@/lib/geom"

export type MotionMode = "idle" | "jog" | "move" | "home" | "probe"
export type MotionBackend = "simulation" | "hardware"

export type MotionSnapshot = {
  position: Vec3
  estop: boolean
  /** 急停或上电后未回零时为 false，此时禁止自动运行。 */
  homed: boolean
  overtravel: Axis | null
  moving: boolean
  mode: MotionMode
  connected: boolean
  backend: MotionBackend
  speedMmPerSec: number
}

export type SoftLimits = {
  min: Vec3
  max: Vec3
}

export interface MotionController {
  getSnapshot(): MotionSnapshot
  jog(axis: Axis, direction: 1 | -1, speedMmPerSec: number): void
  stopJog(): void
  /** 目标超出软限位时直接拒绝（MotionError "overtravel"），绝不截断后继续运动。 */
  moveTo(target: Vec3, speedMmPerSec: number): Promise<void>
  /**
   * 从当前位置沿 direction 触测，最远 maxTravel。
   * 触发时锁存光栅读数并返回球心坐标；行程内未触发返回 null。
   */
  probe(direction: Vec3, maxTravel: number, speedMmPerSec: number): Promise<Vec3 | null>
  home(speedMmPerSec: number): Promise<void>
  estop(): void
  resetEstop(): void
  setSoftLimits(limits: SoftLimits): void
  subscribe(listener: (snapshot: MotionSnapshot) => void): () => void
}

export class MotionError extends Error {
  constructor(
    message: string,
    readonly code: "estop" | "overtravel" | "disconnected" | "busy" | "not-homed" | "collision"
  ) {
    super(message)
    this.name = "MotionError"
  }
}
