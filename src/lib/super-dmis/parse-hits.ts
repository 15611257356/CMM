import type { Vec3 } from "@/lib/geom"
import { uid } from "@/lib/geom"
import { normalize } from "@/lib/math/linalg"
import type { FeatureKind, MeasurementProgram, ProbeHit, ProgramStep, StepHits } from "@/lib/program/types"
import { numbersIn, stripBom } from "@/lib/super-dmis/parse-text"

export type ImportedPoint = { center: Vec3; approach: Vec3 }
export type ImportedFeature = { name: string; kind: FeatureKind; points: ImportedPoint[] }

export type MeasurementImport = {
  format: "dmis" | "csv" | "xinspect-report"
  features: ImportedFeature[]
}

const KIND_ALIASES: Record<string, FeatureKind> = {
  point: "point",
  pt: "point",
  点: "point",
  line: "line",
  ln: "line",
  线: "line",
  直线: "line",
  plane: "plane",
  pln: "plane",
  面: "plane",
  平面: "plane",
  circle: "circle",
  cir: "circle",
  圆: "circle",
  孔: "circle",
  sphere: "sphere",
  sph: "sphere",
  球: "sphere",
}

function kindOf(raw: string): FeatureKind | null {
  const k = raw.trim().toLowerCase()
  return KIND_ALIASES[k] ?? KIND_ALIASES[raw.trim()] ?? null
}

function defaultApproach(kind: FeatureKind): Vec3 {
  if (kind === "line") return { x: 0, y: 1, z: 0 }
  return { x: 0, y: 0, z: -1 }
}

function safeApproach(i: number, j: number, k: number, kind: FeatureKind): Vec3 {
  if (Math.hypot(i, j, k) < 1e-9) return defaultApproach(kind)
  try {
    return normalize({ x: i, y: j, z: k })
  } catch {
    return defaultApproach(kind)
  }
}

function pushFeature(features: ImportedFeature[], name: string, kind: FeatureKind, points: ImportedPoint[]) {
  if (!points.length) return
  features.push({ name: name || `${kind}-${features.length + 1}`, kind, points })
}

function parseDmis(text: string): ImportedFeature[] {
  const features: ImportedFeature[] = []
  let name = ""
  let kind: FeatureKind = "point"
  let points: ImportedPoint[] = []
  const featDecl = /F\(([^)]+)\)\s*=\s*FEAT\/([A-Z]+)/i
  const meas = /MEAS\/([A-Z]+)\s*,\s*F\(([^)]+)\)/i
  const ptmeas = /PTMEAS\/CART\s*,\s*([^\n]+)/i

  const flush = () => {
    pushFeature(features, name, kind, points)
    points = []
  }

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    const decl = line.match(featDecl)
    if (decl) {
      flush()
      name = decl[1]
      kind = kindOf(decl[2]) ?? "point"
      continue
    }
    const m = line.match(meas)
    if (m) {
      flush()
      kind = kindOf(m[1]) ?? kind
      name = m[2]
      continue
    }
    if (/^ENDMES/i.test(line)) {
      flush()
      continue
    }
    const pt = line.match(ptmeas)
    if (pt) {
      const n = numbersIn(pt[1])
      if (n.length >= 3) {
        points.push({
          center: { x: n[0], y: n[1], z: n[2] },
          approach: safeApproach(n[3] ?? 0, n[4] ?? 0, n[5] ?? 0, kind),
        })
      }
    }
  }
  flush()
  return features
}

function parseXInspectReport(text: string): ImportedFeature[] {
  const features: ImportedFeature[] = []
  let kind: FeatureKind | null = null
  let points: ImportedPoint[] = []
  let name = ""
  const section = /^(平面|直线|线|点|圆|孔|球|PLANE|LINE|POINT|CIRCLE|SPHERE)(?=$|[\s:：])/i

  const flush = () => {
    if (kind) pushFeature(features, name || kind, kind, points)
    points = []
  }

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    const sec = line.match(section)
    if (sec && numbersIn(line).length < 3) {
      flush()
      kind = kindOf(sec[1]) ?? "point"
      name = line.replace(section, "").trim() || kind
      continue
    }
    if (!kind) continue
    const n = numbersIn(line)
    if (n.length >= 3) {
      const start = n[0] === Math.floor(n[0]) && n[0] <= 99 && n.length >= 4 ? 1 : 0
      const x = n[start]
      const y = n[start + 1]
      const z = n[start + 2]
      if ([x, y, z].every((v) => Number.isFinite(v))) {
        points.push({ center: { x, y, z }, approach: defaultApproach(kind) })
      }
    }
  }
  flush()
  return features
}

function parseCsv(text: string): ImportedFeature[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("$$"))
  if (!lines.length) return []
  const header = lines[0].split(/[,;\t]/).map((h) => h.trim().toLowerCase())
  const hasHeader =
    header.some((h) => ["x", "y", "z", "i", "j", "k", "name", "kind", "feature", "type"].includes(h)) &&
    header.some((h) => h === "x" || h === "y")

  const features: ImportedFeature[] = []
  const buckets = new Map<string, ImportedFeature>()

  const add = (name: string, kind: FeatureKind, pt: ImportedPoint) => {
    const key = `${name}|${kind}`
    let f = buckets.get(key)
    if (!f) {
      f = { name, kind, points: [] }
      buckets.set(key, f)
      features.push(f)
    }
    f.points.push(pt)
  }

  const body = hasHeader ? lines.slice(1) : lines
  for (const line of body) {
    const cols = line.split(/[,;\t]/).map((c) => c.trim())
    const num = (name: string, fallbackIndex: number) => {
      const i = header.indexOf(name)
      const raw = hasHeader && i >= 0 ? cols[i] : cols[fallbackIndex]
      const v = Number(raw)
      return Number.isFinite(v) ? v : 0
    }
    const nameCol = hasHeader ? header.findIndex((h) => h === "name" || h === "feature" || h === "feat") : -1
    const kindCol = hasHeader ? header.findIndex((h) => h === "kind" || h === "type") : -1
    const name = nameCol >= 0 ? cols[nameCol] || "PNT" : "PNT"
    const kind = (kindCol >= 0 ? kindOf(cols[kindCol] ?? "") : null) ?? "point"
    const x = hasHeader ? num("x", 0) : Number(cols[0])
    const y = hasHeader ? num("y", 1) : Number(cols[1])
    const z = hasHeader ? num("z", 2) : Number(cols[2])
    if (![x, y, z].every(Number.isFinite)) continue
    const i = hasHeader ? num("i", 3) : Number(cols[3] ?? 0)
    const j = hasHeader ? num("j", 4) : Number(cols[4] ?? 0)
    const k = hasHeader ? num("k", 5) : Number(cols[5] ?? 0)
    add(name, kind, { center: { x, y, z }, approach: safeApproach(i, j, k, kind) })
  }
  return features
}

export function parseMeasurementFile(text: string, filename = ""): MeasurementImport {
  const src = stripBom(text)
  const upper = src.toUpperCase()
  if (/PTMEAS\/CART/.test(upper) || /DMISMN\//.test(upper) || /MEAS\/(PLANE|LINE|POINT|CIRCLE|SPHERE)/.test(upper)) {
    const features = parseDmis(src)
    if (!features.length) throw new Error("DMIS 文件里没有 PTMEAS 测点")
    return { format: "dmis", features }
  }
  if (/(^|\n)\s*(平面|直线|线|点)(\s|$)/.test(src) || /xinspect/i.test(filename)) {
    const features = parseXInspectReport(src)
    if (features.length) return { format: "xinspect-report", features }
  }
  const features = parseCsv(src)
  if (!features.length) throw new Error("无法识别测点文件。请导出 SuperDMIS 的 DMIS（含 PTMEAS），或 CSV（X,Y,Z[,I,J,K]）")
  return { format: "csv", features }
}

function normalizeName(s: string): string {
  return s.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "").toLowerCase()
}

export function dmisFeatLabel(step: ProgramStep): string {
  const cleaned = step.id.replace(/[^A-Za-z0-9]/g, "_").replace(/_+/g, "_")
  return cleaned.toUpperCase().slice(0, 16) || "FEAT"
}

export function matchImportedHits(program: MeasurementProgram, imported: ImportedFeature[]): StepHits[] {
  const unused = [...imported]
  const hits: StepHits[] = []

  const take = (step: ProgramStep): ImportedFeature | undefined => {
    const id = normalizeName(step.id)
    const label = normalizeName(dmisFeatLabel(step))
    const name = normalizeName(step.name)
    const idx = unused.findIndex((f) => {
      const n = normalizeName(f.name)
      return n === id || n === label || n === name || n.includes(name) || name.includes(n)
    })
    if (idx >= 0) return unused.splice(idx, 1)[0]
    const byKind = unused.findIndex((f) => f.kind === step.kind)
    if (byKind >= 0) return unused.splice(byKind, 1)[0]
    return undefined
  }

  for (const step of program.steps) {
    const feat = take(step)
    if (!feat) {
      hits.push({ stepId: step.id, hits: [], error: "导入文件没有对应测点" })
      continue
    }
    const mapped: ProbeHit[] = feat.points.map((p, i) => ({
      pointId: step.points[i]?.id ?? `${step.id}-imp-${i}`,
      center: p.center,
      approach: p.approach,
    }))
    hits.push({ stepId: step.id, hits: mapped })
  }
  return hits
}

/** 没有现成程序时，按导入特征生成一份可评价的测量程序。 */
export function programFromImport(imported: ImportedFeature[], name = "SuperDMIS 导入"): MeasurementProgram {
  const steps: ProgramStep[] = imported.map((f, index) => ({
    id: uid("imp"),
    kind: f.kind,
    name: f.name || `${f.kind}${index + 1}`,
    points: f.points.map((p, i) => ({
      id: `imp-${index}-pt-${i}`,
      nominal: p.center,
      approach: p.approach,
    })),
  }))
  const plane = steps.find((s) => s.kind === "plane")
  const line = steps.find((s) => s.kind === "line")
  const point = steps.find((s) => s.kind === "point")
  return {
    id: uid("prog"),
    name,
    steps,
    gdt: [],
    alignment: plane && line && point ? { primary: plane.id, secondary: line.id, origin: point.id } : undefined,
  }
}
