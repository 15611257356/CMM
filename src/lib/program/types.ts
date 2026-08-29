import type { Vec3 } from "@/lib/geom"
import type { CircleFit, PlaneFit } from "@/lib/measure/gdt"

export type FeatureKind = "point" | "plane" | "circle"

export type ProbePoint = {
  id: string
  nominal: Vec3
  measured?: Vec3
}

export type ProgramStep = {
  id: string
  kind: FeatureKind
  name: string
  points: ProbePoint[]
  nominalCenter?: { x: number; y: number; z: number }
  nominalRadius?: number
}

export type GdtType = "flatness" | "circularity" | "position" | "coaxiality"

export type GdtCheck = {
  id: string
  type: GdtType
  name: string
  featureIds: string[]
  tolerance: number
}

export type MeasurementProgram = {
  id: string
  name: string
  steps: ProgramStep[]
  gdt: GdtCheck[]
}

export type FeatureResult = {
  stepId: string
  name: string
  kind: FeatureKind
  plane?: PlaneFit
  circle?: CircleFit
  point?: Vec3
}

export type GdtResult = {
  checkId: string
  name: string
  type: GdtType
  value: number
  tolerance: number
  passed: boolean
}

export type ReportSnapshot = {
  createdAt: string
  programName: string
  features: FeatureResult[]
  gdt: GdtResult[]
}

export type LogLevel = "info" | "warn" | "error"

export type LogEntry = {
  id: string
  at: string
  level: LogLevel
  message: string
}
