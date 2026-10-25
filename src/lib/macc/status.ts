/** 探针模块状态字 MACC_get_probe_status */
export const PROBE_LATCH = 0x0001
export const PROBE_TRIGGERED = 0x0002
export const PROBE_ENABLED = 0x0004
export const PROBE_HEAD_DRIVE_ALARM = 0x0008
export const PROBE_HEAD_MISSING = 0x0010
export const PROBE_TIP_MISSING = 0x0020
export const PROBE_HEAD_MOVE_DONE = 0x0040
export const PROBE_HEAD_LOCK_ALARM = 0x0080
export const PROBE_PHC_COMM_ALARM = 0x0100

/** 运动模块状态字 MACC_get_motion_status */
export const MOTION_ALL_STOPPED = 0x0001
export const MOTION_ERROR_FLAG = 0x0002
export const MOTION_JOYSTICK_ENABLED = 0x0008
export const MOTION_X_STOPPED = 0x0010
export const MOTION_Y_STOPPED = 0x0020
export const MOTION_Z_STOPPED = 0x0040
export const MOTION_U_STOPPED = 0x0080
export const MOTION_MEASURE_3D = 0x0100
export const MOTION_PROBE_ENABLED = 0x0200
export const MOTION_ESTOP = 0x0400
export const MOTION_TOUCH_FAULT = 0x0800
export const MOTION_JOYSTICK_TOUCH_FAULT = 0x1000
export const MOTION_PROBE_READY = 0x2000
export const MOTION_PROBE_UNEXPECTED = 0x4000
export const MOTION_TOUCHING = 0x8000

/** 轴状态字 MACC_get_axis_status，数组 [X,Y,Z,...] */
export const AXIS_POS_LIMIT = 0x0020
export const AXIS_NEG_LIMIT = 0x0040
export const AXIS_HOME_SWITCH = 0x0080
export const AXIS_STOPPED = 0x0400
export const AXIS_HOMED = 0x0800
export const AXIS_HOMING = 0x1000
export const AXIS_RI_FAIL = 0x4000
export const AXIS_FOLLOW_ERROR = 0x8000

export const AXIS_X = 0
export const AXIS_Y = 1
export const AXIS_Z = 2

export function bit(word: number, mask: number): boolean {
  return (word & mask) !== 0
}

export type ParsedMotionStatus = {
  allStopped: boolean
  error: boolean
  joystickEnabled: boolean
  estop: boolean
  probeEnabled: boolean
  probeReady: boolean
  touching: boolean
  touchFault: boolean
  unexpectedTrigger: boolean
}

export function parseMotionStatus(word: number): ParsedMotionStatus {
  return {
    allStopped: bit(word, MOTION_ALL_STOPPED),
    error: bit(word, MOTION_ERROR_FLAG),
    joystickEnabled: bit(word, MOTION_JOYSTICK_ENABLED),
    estop: bit(word, MOTION_ESTOP),
    probeEnabled: bit(word, MOTION_PROBE_ENABLED),
    probeReady: bit(word, MOTION_PROBE_READY),
    touching: bit(word, MOTION_TOUCHING),
    touchFault: bit(word, MOTION_TOUCH_FAULT),
    unexpectedTrigger: bit(word, MOTION_PROBE_UNEXPECTED),
  }
}

export function parseAxisHomed(status: number[]): boolean {
  return [0, 1, 2].every((i) => bit(status[i] ?? 0, AXIS_HOMED))
}

export function firstOvertravel(status: number[]): "x" | "y" | "z" | null {
  const axes = ["x", "y", "z"] as const
  for (let i = 0; i < 3; i++) {
    const w = status[i] ?? 0
    if (bit(w, AXIS_POS_LIMIT) || bit(w, AXIS_NEG_LIMIT)) return axes[i]
  }
  return null
}
