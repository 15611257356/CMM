import type { Vec3 } from "@/lib/geom"
import type { MeasurementProgram, ProgramStep } from "@/lib/program/types"
import { dmisFeatLabel } from "@/lib/super-dmis/parse-hits"

function vec(p: Vec3): string {
  return `${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)}`
}

function outward(approach: Vec3): Vec3 {
  return { x: -approach.x, y: -approach.y, z: -approach.z }
}

function featTag(name: string): string {
  return "F(" + name + ")"
}

function featDecl(step: ProgramStep): string {
  const tag = featTag(dmisFeatLabel(step))
  const p0 = step.points[0]
  if (!p0) return `${tag}=FEAT/POINT,CART,0,0,0,0,0,1`
  const n = outward(p0.approach)
  switch (step.kind) {
    case "plane":
      return `${tag}=FEAT/PLANE,CART,${vec(p0.nominal)},${vec(n)}`
    case "line": {
      const p1 = step.points[step.points.length - 1] ?? p0
      return `${tag}=FEAT/LINE,CART,${vec(p0.nominal)},${vec({
        x: p1.nominal.x - p0.nominal.x,
        y: p1.nominal.y - p0.nominal.y,
        z: p1.nominal.z - p0.nominal.z,
      })},${vec(n)}`
    }
    case "circle": {
      const c = step.nominalCenter ?? p0.nominal
      const r = step.nominalRadius ?? 0
      const axis = step.axis ?? { x: 0, y: 0, z: 1 }
      const inner = step.inner === false ? "OUTER" : "INNER"
      return `${tag}=FEAT/CIRCLE,CART,${vec(c)},${vec(axis)},${r.toFixed(4)},${inner}`
    }
    case "sphere": {
      const c = step.nominalCenter ?? p0.nominal
      const r = step.nominalRadius ?? 0
      return `${tag}=FEAT/SPHERE,CART,${vec(c)},${r.toFixed(4)}`
    }
    default:
      return `${tag}=FEAT/POINT,CART,${vec(p0.nominal)},${vec(n)}`
  }
}

function measKind(step: ProgramStep): string {
  return { point: "POINT", line: "LINE", plane: "PLANE", circle: "CIRCLE", sphere: "SPHERE" }[step.kind]
}

/**
 * SuperDMIS BASIC 可执行的 DMIS 5.2。
 * 特征名只用 ASCII（安装路径同样禁止中文/空格/特殊字符，见 SuperDMIS 安装手册）。
 */
export function exportSuperDmis(program: MeasurementProgram): string {
  const title = program.name.replace(/[^\x20-\x7E]/g, " ").replace(/'/g, "")
  const lines = [
    `DMISMN/'${title.trim() || "PRECHECK"}',05.2`,
    "UNITS/MM,ANGDEC",
    "WKPLAN/XYPLAN",
    "PRCOMP/ON",
    `$$ ${program.name}`,
  ]
  for (const step of program.steps) {
    if (!step.points.length) continue
    const tag = featTag(dmisFeatLabel(step))
    lines.push(`$$ ${step.name}`)
    lines.push(featDecl(step))
    lines.push(`MEAS/${measKind(step)}, ${tag}, ${step.points.length}`)
    for (const p of step.points) {
      lines.push(`  PTMEAS/CART,${vec(p.nominal)},${vec(outward(p.approach))}`)
    }
    lines.push("ENDMES")
  }
  lines.push("ENDFIL")
  return lines.join("\r\n") + "\r\n"
}

/** SuperDMIS 安装手册：路径只能有英文、数字、减号、下划线。 */
export function superDmisSafeName(name: string, ext = "dms"): string {
  const stem = name
    .replace(/\.[^.]+$/, "")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
  return `${stem || "PRECHECK"}.${ext}`
}
