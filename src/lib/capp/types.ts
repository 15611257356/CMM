export type PartFamily = "base-plate" | "clamp-plate"

export type BlankType = "板材" | "块料" | "圆钢下料"

export type FixtureMode = "通用装夹" | "专用夹具"

export type ReviewStatus = "pending" | "accepted" | "adjust"

export type ProcessStep = {
  seq: number
  name: string
  content: string
  machine: string
}

export type PilotCase = {
  id: string
  name: string
  family: PartFamily
  familyLabel: string
  material: string
  thicknessMm: number
  lotSize: number
  features: string[]
  hasPrecisionHole: boolean
  datumUncut: boolean
  irregular: boolean
  actualRoute: ProcessStep[]
  actualBlank: BlankType
  actualFixture: FixtureMode
  note: string
}

export type DecisionRule = {
  id: string
  topic: "blank" | "sequence" | "fixture"
  question: string
  logic: string
  enabled: boolean
}

export type GeneratedPlan = {
  caseId: string
  blank: BlankType
  blankReason: string
  fixture: FixtureMode
  fixtureReason: string
  steps: ProcessStep[]
}

export type ReviewRecord = {
  caseId: string
  status: ReviewStatus
  comment: string
  at: string
}
