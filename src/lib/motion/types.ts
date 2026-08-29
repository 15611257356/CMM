import type { Axis, Vec3 } from "@/lib/geom"

export type MotionMode = "idle" | "jog" | "move" | "home"
export type MotionBackend = "simulation" | "hardware"

export type MotionSnapshot = {
  position: Vec3
  estop: boolean
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
  moveTo(target: Vec3, speedMmPerSec: number): Promise<void>
  home(speedMmPerSec: number): Promise<void>
  estop(): void
  resetEstop(): void
  setSoftLimits(limits: SoftLimits): void
  subscribe(listener: (snapshot: MotionSnapshot) => void): () => void
}

export class MotionError extends Error {
  constructor(
    message: string,
    readonly code: "estop" | "overtravel" | "disconnected" | "busy"
  ) {
    super(message)
    this.name = "MotionError"
  }
}
