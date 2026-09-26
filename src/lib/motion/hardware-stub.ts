import { MACHINE } from "@/lib/geom"
import { MotionError, type MotionController, type MotionSnapshot } from "@/lib/motion/types"

/**
 * 真机运控卡桩：接口保留，当前未连接，禁止上机。
 * 真机实现应放在本地设备服务里（调用运控卡厂商 SDK），网页通过 WebSocket 下发指令；
 * 急停和硬限位必须走硬件回路，软件只做第二道保护。
 */
export class HardwareMotionController implements MotionController {
  private listeners = new Set<(snapshot: MotionSnapshot) => void>()

  getSnapshot(): MotionSnapshot {
    return {
      position: { ...MACHINE.home },
      estop: false,
      homed: false,
      overtravel: null,
      moving: false,
      mode: "idle",
      connected: false,
      backend: "hardware",
      speedMmPerSec: 0,
    }
  }

  subscribe(listener: (snapshot: MotionSnapshot) => void): () => void {
    this.listeners.add(listener)
    listener(this.getSnapshot())
    return () => this.listeners.delete(listener)
  }

  jog(): void {
    throw new MotionError("运动控制卡未连接（硬件桩）", "disconnected")
  }

  stopJog(): void {}

  moveTo(): Promise<void> {
    return Promise.reject(new MotionError("运动控制卡未连接（硬件桩）", "disconnected"))
  }

  probe(): Promise<null> {
    return Promise.reject(new MotionError("测头未连接（硬件桩）", "disconnected"))
  }

  home(): Promise<void> {
    return Promise.reject(new MotionError("运动控制卡未连接（硬件桩）", "disconnected"))
  }

  estop(): void {}
  resetEstop(): void {}
  setSoftLimits(): void {}
}
