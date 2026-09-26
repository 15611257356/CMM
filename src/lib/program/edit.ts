import type { AlignmentDef, MeasurementProgram, ProbePoint, ProgramStep } from "@/lib/program/types"
import { circleStep } from "@/lib/program/demo"

const POINT_LIMIT: Record<ProgramStep["kind"], { min: number; max: number }> = {
  point: { min: 1, max: 1 },
  line: { min: 2, max: 8 },
  plane: { min: 3, max: 9 },
  circle: { min: 3, max: 12 },
  sphere: { min: 4, max: 9 },
}

function replaceStep(program: MeasurementProgram, id: string, next: ProgramStep): MeasurementProgram {
  return { ...program, steps: program.steps.map((step) => (step.id === id ? next : step)) }
}

export function renameProgram(program: MeasurementProgram, name: string): MeasurementProgram {
  const trimmed = name.trim()
  return trimmed ? { ...program, name: trimmed } : program
}

export function renameStep(program: MeasurementProgram, id: string, name: string): MeasurementProgram {
  const trimmed = name.trim()
  if (!trimmed) return program
  const step = program.steps.find((item) => item.id === id)
  if (!step) return program
  return {
    ...replaceStep(program, id, { ...step, name: trimmed }),
    gdt: program.gdt.map((check) =>
      check.featureIds[0] === id && check.featureIds.length === 1 && !check.datumIds?.length
        ? { ...check, name: check.name.replace(step.name, trimmed) }
        : check
    ),
  }
}

function linePoints(step: ProgramStep, count: number): ProbePoint[] {
  const a = step.points[0]
  const b = step.points[step.points.length - 1]
  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0 : i / (count - 1)
    return {
      id: `${step.id}-pt-${i}`,
      nominal: {
        x: a.nominal.x + (b.nominal.x - a.nominal.x) * t,
        y: a.nominal.y + (b.nominal.y - a.nominal.y) * t,
        z: a.nominal.z + (b.nominal.z - a.nominal.z) * t,
      },
      approach: a.approach,
    }
  })
}

function planePoints(step: ProgramStep, count: number): ProbePoint[] {
  const xs = step.points.map((p) => p.nominal.x)
  const ys = step.points.map((p) => p.nominal.y)
  const z = step.points[0].nominal.z
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const cols = count <= 3 ? count : count <= 4 ? 2 : 3
  const rows = Math.ceil(count / cols)
  const approach = step.points[0].approach
  return Array.from({ length: count }, (_, i) => {
    const c = i % cols
    const r = Math.floor(i / cols)
    const x = cols === 1 ? (minX + maxX) / 2 : minX + ((maxX - minX) * c) / (cols - 1)
    const y = rows === 1 ? (minY + maxY) / 2 : minY + ((maxY - minY) * r) / (rows - 1)
    return { id: `${step.id}-pt-${i}`, nominal: { x, y, z }, approach }
  })
}

export function setPointCount(program: MeasurementProgram, id: string, count: number): MeasurementProgram {
  const step = program.steps.find((item) => item.id === id)
  if (!step || step.points.length === 0) return program
  const limit = POINT_LIMIT[step.kind]
  const n = Math.max(limit.min, Math.min(limit.max, Math.round(count)))
  if (step.kind === "point" || step.kind === "sphere") return program
  if (step.kind === "circle") {
    const center = step.nominalCenter ?? step.points[0].nominal
    const radius = step.nominalRadius ?? 8
    const rebuilt = circleStep(step.id, step.name, center, radius, step.inner !== false, n, step.sizeTolerance)
    return replaceStep(program, id, { ...step, ...rebuilt, points: rebuilt.points })
  }
  const points = step.kind === "line" ? linePoints(step, n) : planePoints(step, n)
  return replaceStep(program, id, { ...step, points })
}

export function setCircleSpec(
  program: MeasurementProgram,
  id: string,
  spec: { diameter?: number; sizeTolerance?: number | null }
): MeasurementProgram {
  const step = program.steps.find((item) => item.id === id)
  if (!step || step.kind !== "circle") return program
  const radius = spec.diameter !== undefined ? Math.max(0.5, spec.diameter / 2) : (step.nominalRadius ?? 8)
  const sizeTolerance =
    spec.sizeTolerance === null
      ? undefined
      : spec.sizeTolerance !== undefined
        ? spec.sizeTolerance
        : step.sizeTolerance
  const count = Math.max(3, step.points.length)
  const rebuilt = circleStep(
    step.id,
    step.name,
    step.nominalCenter ?? step.points[0].nominal,
    radius,
    step.inner !== false,
    count,
    sizeTolerance
  )
  return replaceStep(program, id, { ...step, ...rebuilt })
}

const ROLE_KIND = { primary: "plane", secondary: "line", origin: "point" } as const

export function setAlignmentRole(
  program: MeasurementProgram,
  role: keyof AlignmentDef,
  stepId: string | null
): { program: MeasurementProgram; error?: string } {
  if (stepId) {
    const step = program.steps.find((item) => item.id === stepId)
    if (!step) return { program, error: "找不到该特征" }
    if (step.kind !== ROLE_KIND[role]) {
      const need = ROLE_KIND[role] === "plane" ? "平面" : ROLE_KIND[role] === "line" ? "直线" : "点"
      return { program, error: `这一项必须是${need}` }
    }
  }
  const current: Partial<AlignmentDef> = { ...program.alignment }
  if (stepId) current[role] = stepId
  else delete current[role]
  const alignment = current.primary || current.secondary || current.origin ? current : undefined
  return { program: { ...program, alignment } }
}

export function setGdtTolerance(program: MeasurementProgram, checkId: string, tolerance: number): MeasurementProgram {
  if (!Number.isFinite(tolerance) || tolerance <= 0) return program
  return {
    ...program,
    gdt: program.gdt.map((check) => (check.id === checkId ? { ...check, tolerance } : check)),
  }
}
