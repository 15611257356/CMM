import type { Vec3 } from "@/lib/geom"
import type { MachineToolConfig } from "@/lib/coords/work-offset"
import { compose, fromPoseDeg, type RigidTransform } from "@/lib/math/transform"

/**
 * 零点托盘：托盘坐标系原点在托盘上表面中心。
 * nominalToMachine 是设计值；实际值要用标准球标定（见 calibratePallet）。
 */
export const PALLET = {
  size: { x: 260, y: 200 },
  /** 托盘上表面到大理石台面的高度（含零点卡盘）。 */
  height: 60,
  nominalToMachine: fromPoseDeg({ x: 250, y: 200, z: 60, rz: 0, ry: 0, rx: 0 }),
  referenceSphere: {
    center: { x: -118, y: 88, z: 12 } satisfies Vec3,
    /** 标准球证书直径 10.0000 mm。 */
    radius: 5,
    stemRadius: 2,
  },
}

export const PROBE = {
  /** 名义测针：Ø4 红宝石球。实际有效半径由标准球标定得到。 */
  nominalTipRadius: 2,
  retract: 5,
  searchTravel: 12,
  clearanceAbovePart: 25,
}

/** 示例零件：夹具底板，零件坐标系原点在前左上角（加工常用的对刀点）。 */
export const PLATE = {
  name: "夹具底板 BP-01",
  w: 200,
  d: 140,
  h: 20,
  holes: [
    { id: "A", name: "孔A", x: 40, y: 30, r: 8 },
    { id: "B", name: "孔B", x: 160, y: 30, r: 8 },
    { id: "C", name: "孔C", x: 40, y: 110, r: 8 },
    { id: "D", name: "孔D", x: 160, y: 110, r: 8 },
  ],
}

/** 名义装夹：零件原点在托盘坐标 (-100, -70, 20)，即零件居中放在托盘上。 */
export const NOMINAL_PART_ON_PALLET: RigidTransform = fromPoseDeg({
  x: -PLATE.w / 2,
  y: -PLATE.d / 2,
  z: PLATE.h,
  rz: 0,
  ry: 0,
  rx: 0,
})

export function nominalPartToMachine(palletToMachine: RigidTransform): RigidTransform {
  return compose(palletToMachine, NOMINAL_PART_ON_PALLET)
}

export const DEFAULT_MACHINE_TOOL: MachineToolConfig = {
  name: "立式加工中心（FANUC）",
  palletZeroOnMachine: { x: -412.5, y: -236.8, z: -385.2 },
  palletRotationDeg: 0,
  register: "G54",
  travel: {
    min: { x: -850, y: -500, z: -550 },
    max: { x: 0, y: 0, z: 0 },
  },
}
