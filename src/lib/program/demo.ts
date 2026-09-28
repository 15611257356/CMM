import { PLATE } from "@/lib/machine/setup"
import { autoProgram, type PartModel } from "@/lib/program/auto"
import type { GdtType, MeasurementProgram } from "@/lib/program/types"

export { circleStep } from "@/lib/program/auto"

export const PLATE_MODEL: PartModel = {
  id: "bp01",
  name: PLATE.name,
  w: PLATE.w,
  d: PLATE.d,
  h: PLATE.h,
  holes: PLATE.holes,
}

export function createDemoProgram(): MeasurementProgram {
  return autoProgram(PLATE_MODEL, "post", { sizeTolerance: null, name: `${PLATE.name} 预检程序` })
}

/** 加工前：只找基准，用来出装夹偏差和工件坐标系。 */
export function createPresetProgram(): MeasurementProgram {
  return autoProgram(PLATE_MODEL, "preset")
}

/** 加工后回机：在同一套基准上复测孔径、位置和形位公差。尺寸按 20 °C 图纸。 */
export function createPostProgram(): MeasurementProgram {
  return autoProgram(PLATE_MODEL, "post")
}

export const GDT_LABEL: Record<GdtType, string> = {
  flatness: "平面度",
  straightness: "直线度",
  circularity: "圆度",
  position: "位置度",
  coaxiality: "同轴度",
  parallelism: "平行度",
  perpendicularity: "垂直度",
}

export const KIND_LABEL = { point: "点", line: "直线", plane: "平面", circle: "圆", sphere: "球" } as const
