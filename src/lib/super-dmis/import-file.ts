import { compensatePoint, emptyGeom21, type Geom21 } from "@/lib/super-dmis/geom21"
import { parseStepGaugeDat, type StepGaugeTruth } from "@/lib/super-dmis/parse-dat"
import { parseMeasurementFile, type MeasurementImport } from "@/lib/super-dmis/parse-hits"
import { parseNonlinear } from "@/lib/super-dmis/parse-nonlinear"

export type DetectedImport =
  | { kind: "measurement"; data: MeasurementImport }
  | { kind: "nonlinear"; data: Geom21 }
  | { kind: "step-gauge"; data: StepGaugeTruth }

export function detectAndParse(text: string, filename = ""): DetectedImport {
  const lower = filename.toLowerCase()
  if (lower.endsWith(".dat") && !/dmis/i.test(text)) {
    return { kind: "step-gauge", data: parseStepGaugeDat(text) }
  }
  if (/AXIS\s*[/=:]?\s*[XYZ]/i.test(text) || /linX/i.test(text) || /EXX/i.test(text) || /nonlinear/i.test(lower)) {
    return { kind: "nonlinear", data: parseNonlinear(text, filename) }
  }
  if (lower.endsWith(".csv") && /pos/i.test(text) && /lin/i.test(text)) {
    return { kind: "nonlinear", data: parseNonlinear(text, filename) }
  }
  try {
    return { kind: "measurement", data: parseMeasurementFile(text, filename) }
  } catch (measureError) {
    try {
      return { kind: "nonlinear", data: parseNonlinear(text, filename) }
    } catch {
      throw measureError
    }
  }
}

export function compensateImport(data: MeasurementImport, geom: Geom21, enabled: boolean): MeasurementImport {
  if (!enabled) return data
  return {
    ...data,
    features: data.features.map((f) => ({
      ...f,
      points: f.points.map((p) => ({ ...p, center: compensatePoint(geom, p.center) })),
    })),
  }
}

export function identityGeom(): Geom21 {
  return emptyGeom21()
}
