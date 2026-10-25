import type { Axis, Vec3 } from "@/lib/geom"

/**
 * 本机 Windows 桥接协议。浏览器不能加载 MACC.dll，也不能直连控制器以太网。
 * 工控机上跑一个小服务：加载 MACC.dll，把下面的 JSON 转成 DLL 调用。
 *
 * 默认地址 ws://127.0.0.1:17652/macc
 */
export const DEFAULT_MACC_BRIDGE = "ws://127.0.0.1:17652/macc"

export type MaccMethod =
  | "MACC_initial"
  | "MACC_close"
  | "MACC_get_probe_status"
  | "MACC_get_position"
  | "MACC_get_motion_status"
  | "MACC_get_axis_status"
  | "MACC_go_home"
  | "MACC_XYZ_move_to"
  | "MACC_set_retract_parameter"
  | "MACC_touch_move"
  | "MACC_get_probe_capture_position"
  | "MACC_jog_start"
  | "MACC_change_speed"
  | "MACC_jog_stop"
  | "MACC_stop"
  | "MACC_disable_joystick"
  | "MACC_enable_joystick"
  | "MACC_enable_probe"
  | "MACC_disable_probe"
  | "MACC_get_soft_limit"
  | "MACC_get_last_err"
  | "MACC_clear_err"
  | "MACC_get_serialno"
  | "MACC_set_probe_head_pos"
  | "MACC_get_probe_head_pos"
  | "MACC_machine_error_compensation"
  | "MACC_temperature_compensation_enable"
  | "MACC_get_part_temperature"
  | "MACC_get_firmware"

export type MaccRequest = { id: number; method: MaccMethod; args?: unknown[] }
export type MaccResponse = { id: number; code: number; result?: unknown }

export type MaccTelemetry = {
  connected: boolean
  serial: string
  firmwareF: string
  firmwareD: string
  partTempC: number | null
  probeStatus: number
  motionStatus: number
  axisStatus: number[]
  machineComp: boolean
  temperatureComp: boolean
  bridgeUrl: string
}

export const emptyTelemetry = (bridgeUrl = DEFAULT_MACC_BRIDGE): MaccTelemetry => ({
  connected: false,
  serial: "",
  firmwareF: "",
  firmwareD: "",
  partTempC: null,
  probeStatus: 0,
  motionStatus: 0,
  axisStatus: [0, 0, 0],
  machineComp: false,
  temperatureComp: false,
  bridgeUrl,
})

export function axisIndex(axis: Axis): number {
  return axis === "x" ? 0 : axis === "y" ? 1 : 2
}

export function xyzArray(p: Vec3): [number, number, number] {
  return [p.x, p.y, p.z]
}
