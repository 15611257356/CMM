import type { CameraDriver } from "@/lib/vision/types"

/** 工业相机桩：接口保留，当前未连接。 */
export class HardwareCameraDriver implements CameraDriver {
  isConnected(): boolean {
    return false
  }

  grabFrame(): Promise<ImageData> {
    return Promise.reject(new Error("工业相机未连接（硬件桩）"))
  }
}

export class SimulatedCamera implements CameraDriver {
  constructor(private grab: () => Promise<ImageData>) {}

  isConnected(): boolean {
    return true
  }

  grabFrame(): Promise<ImageData> {
    return this.grab()
  }
}
