import type { Vec3 } from "@/lib/geom"
import type { PalletOffsetResult } from "@/lib/coords/work-offset"
import type { CircleFit, LineFit, PlaneFit, SphereFit } from "@/lib/measure/fit"
import type { PoseDeg, RigidTransform } from "@/lib/math/transform"

export type FeatureKind = "point" | "line" | "plane" | "circle" | "sphere"

/** 测点全部用零件坐标系定义；运行时按装夹变换到机床坐标。 */
export type ProbePoint = {
  id: string
  /** 名义表面点（零件坐标）。 */
  nominal: Vec3
  /** 触测方向，单位向量，从测头指向材料（零件坐标）。 */
  approach: Vec3
}

export type ProgramStep = {
  id: string
  kind: FeatureKind
  name: string
  points: ProbePoint[]
  nominalCenter?: Vec3
  nominalRadius?: number
  /** 圆：true 为孔，false 为轴/凸台。 */
  inner?: boolean
  /** 圆的名义轴线方向（零件坐标），默认 +Z。 */
  axis?: Vec3
}

export type GdtType =
  | "flatness"
  | "straightness"
  | "circularity"
  | "position"
  | "coaxiality"
  | "parallelism"
  | "perpendicularity"

export type GdtCheck = {
  id: string
  type: GdtType
  name: string
  featureIds: string[]
  /** 基准特征（同轴度、平行度、垂直度用）。 */
  datumIds?: string[]
  tolerance: number
}

/** 3-2-1 找正：第一基准面 / 第二基准线 / 原点。 */
export type AlignmentDef = {
  primary: string
  secondary: string
  origin: string
}

export type MeasurementProgram = {
  id: string
  name: string
  steps: ProgramStep[]
  gdt: GdtCheck[]
  alignment?: AlignmentDef
}

export type ProbeHit = {
  pointId: string
  /** 锁存的球心（机床坐标）。 */
  center: Vec3
  /** 触测方向（机床坐标）。 */
  approach: Vec3
}

export type StepHits = { stepId: string; hits: ProbeHit[]; error?: string }

export type FeatureResult = {
  stepId: string
  name: string
  kind: FeatureKind
  ok: boolean
  error?: string
  /** 以下拟合结果均已做测针半径补偿，位于机床坐标系。 */
  plane?: PlaneFit
  line?: LineFit
  circle?: CircleFit
  sphere?: SphereFit
  point?: Vec3
  /** 补偿后的表面点（机床坐标），用于显示与形位公差。 */
  surfacePoints: Vec3[]
  /** 零件坐标系下的圆心/点位置，建立坐标系后才有。 */
  inPart?: Vec3
  diameter?: number
}

export type GdtResult = {
  checkId: string
  name: string
  type: GdtType
  value: number
  tolerance: number
  passed: boolean
}

export type Evaluation = {
  features: FeatureResult[]
  gdt: GdtResult[]
  aligned: boolean
  alignmentNote: string
  partToMachine: RigidTransform
  pallet: PalletOffsetResult
  tipRadius: number
}

export type ReportSnapshot = {
  createdAt: string
  programName: string
  features: FeatureResult[]
  gdt: GdtResult[]
  aligned: boolean
  alignmentNote: string
  palletDelta: PoseDeg
  tiltWarning: string | null
  tipRadius: number
  calibrated: boolean
}

export type LogLevel = "info" | "warn" | "error"

export type LogEntry = {
  id: string
  at: string
  level: LogLevel
  message: string
}
