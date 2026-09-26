import type { Vec3 } from "@/lib/geom"
import { compose, invert, toPoseDeg, type PoseDeg, type RigidTransform } from "@/lib/math/transform"

export const WORK_OFFSETS = ["G54", "G55", "G56", "G57", "G58", "G59"] as const
export type WorkOffsetCode = (typeof WORK_OFFSETS)[number]

export type MachineToolConfig = {
  name: string
  /** 零点托盘装到机床上后，托盘零点在机床机械坐标系中的位置（出厂/首件标定）。 */
  palletZeroOnMachine: Vec3
  /** 托盘在机床上绕 Z 的安装角（度），键槽定位时通常为 0。 */
  palletRotationDeg: number
  register: WorkOffsetCode
  travel: { min: Vec3; max: Vec3 }
}

export type PalletOffsetResult = {
  /** 零件实际坐标系相对托盘零点。 */
  actual: PoseDeg
  /** 零件理论（名义装夹）坐标系相对托盘零点。 */
  nominal: PoseDeg
  /** 实际相对名义的偏差（在托盘坐标系下）。 */
  delta: PoseDeg
  /** 名义零件坐标系下，从理论位置到实际位置的变换，用于改写加工程序。 */
  deltaInNominalPart: RigidTransform
  tiltWarning: string | null
}

/** 3 轴机床不能靠坐标系补偿零件倾斜，超过该值给出提示。 */
export const TILT_LIMIT_DEG = 0.01

export function palletOffset(
  partToMachine: RigidTransform,
  palletToMachine: RigidTransform,
  nominalPartToPallet: RigidTransform
): PalletOffsetResult {
  const partToPallet = compose(invert(palletToMachine), partToMachine)
  const actual = toPoseDeg(partToPallet)
  const nominal = toPoseDeg(nominalPartToPallet)
  const deltaInNominalPart = compose(invert(nominalPartToPallet), partToPallet)
  const tilt = Math.max(Math.abs(actual.rx - nominal.rx), Math.abs(actual.ry - nominal.ry))
  return {
    actual,
    nominal,
    delta: {
      x: actual.x - nominal.x,
      y: actual.y - nominal.y,
      z: actual.z - nominal.z,
      rz: actual.rz - nominal.rz,
      ry: actual.ry - nominal.ry,
      rx: actual.rx - nominal.rx,
    },
    deltaInNominalPart,
    tiltWarning:
      tilt > TILT_LIMIT_DEG
        ? `零件相对托盘倾斜 ${tilt.toFixed(4)}°，超过 ${TILT_LIMIT_DEG}°。3 轴机床无法用坐标系补偿倾斜，请检查装夹或垫实。`
        : null,
  }
}

export type WorkOffsetValues = {
  register: WorkOffsetCode
  x: number
  y: number
  z: number
  /** 绕 Z 的旋转（度），配合 G68 使用。 */
  rotationDeg: number
}

function rotateXY(p: { x: number; y: number }, deg: number) {
  const a = (deg * Math.PI) / 180
  return { x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) }
}

/** 以托盘零点为桥，把零件相对托盘的位姿换算成机床上的工件坐标系偏置。 */
export function workOffsetFromPose(partOnPallet: PoseDeg, tool: MachineToolConfig): WorkOffsetValues {
  const xy = rotateXY(partOnPallet, tool.palletRotationDeg)
  return {
    register: tool.register,
    x: tool.palletZeroOnMachine.x + xy.x,
    y: tool.palletZeroOnMachine.y + xy.y,
    z: tool.palletZeroOnMachine.z + partOnPallet.z,
    rotationDeg: partOnPallet.rz + tool.palletRotationDeg,
  }
}

const P_INDEX: Record<WorkOffsetCode, number> = { G54: 1, G55: 2, G56: 3, G57: 4, G58: 5, G59: 6 }

function fmt(value: number): string {
  return value.toFixed(4)
}

/** FANUC 风格：G10 L2 写工件坐标系，G68 做坐标旋转。 */
export function workOffsetNc(values: WorkOffsetValues, withRotation: boolean): string {
  const lines = [
    `(预检机输出 ${values.register} 工件坐标系)`,
    `G10 L2 P${P_INDEX[values.register]} X${fmt(values.x)} Y${fmt(values.y)} Z${fmt(values.z)}`,
  ]
  if (withRotation && Math.abs(values.rotationDeg) > 1e-5) {
    lines.push(`(在加工程序开头调用，结束前用 G69 取消)`)
    lines.push(`${values.register} G17 G68 X0 Y0 R${values.rotationDeg.toFixed(5)}`)
  }
  return lines.join("\n")
}
