import type { Vec3 } from "@/lib/geom"
import type { MeasurementProgram, ProgramStep } from "@/lib/program/types"

/**
 * 导出 DMIS 5 风格测量程序，给现成三坐标软件执行采点。
 * 坐标用零件坐标系；PTMEAS 的矢量是表面外法向（与测头逼近方向相反）。
 * 不同软件对 DMIS 的支持程度不一，导入后须在目标软件里核对一遍再上机。
 */

function n(value: number): string {
  const text = value.toFixed(4)
  return text === "-0.0000" ? "0.0000" : text
}

function label(step: ProgramStep, index: number): string {
  const ascii = step.id.replace(/^feat-/, "").replace(/[^A-Za-z0-9]/g, "_").toUpperCase()
  return ascii || `F${index + 1}`
}

function vec(p: Vec3): string {
  return `${n(p.x)},${n(p.y)},${n(p.z)}`
}

function outward(approach: Vec3): Vec3 {
  return { x: -approach.x, y: -approach.y, z: -approach.z }
}

function featLine(step: ProgramStep, name: string): string {
  const p0 = step.points[0]
  switch (step.kind) {
    case "plane":
      return `F(${name})=FEAT/PLANE,CART,${vec(p0.nominal)},${vec(outward(p0.approach))}`
    case "line": {
      const p1 = step.points[step.points.length - 1]
      const d = { x: p1.nominal.x - p0.nominal.x, y: p1.nominal.y - p0.nominal.y, z: p1.nominal.z - p0.nominal.z }
      const len = Math.hypot(d.x, d.y, d.z) || 1
      return `F(${name})=FEAT/LINE,UNBND,CART,${vec(p0.nominal)},${n(d.x / len)},${n(d.y / len)},${n(d.z / len)}`
    }
    case "circle": {
      const c = step.nominalCenter ?? p0.nominal
      const axis = step.axis ?? { x: 0, y: 0, z: 1 }
      const diameter = (step.nominalRadius ?? 0) * 2
      return `F(${name})=FEAT/CIRCLE,${step.inner === false ? "OUTER" : "INNER"},CART,${vec(c)},${vec(axis)},${n(diameter)}`
    }
    case "sphere": {
      const c = step.nominalCenter ?? p0.nominal
      return `F(${name})=FEAT/SPHERE,OUTER,CART,${vec(c)},${n((step.nominalRadius ?? 0) * 2)}`
    }
    case "point":
      return `F(${name})=FEAT/POINT,CART,${vec(p0.nominal)},${vec(outward(p0.approach))}`
  }
}

export function exportDmis(program: MeasurementProgram): string {
  const names = new Map(program.steps.map((step, index) => [step.id, label(step, index)]))
  const lines: string[] = [
    `DMISMN/'${program.name.replace(/'/g, "")}',05.2`,
    "UNITS/MM,ANGDEC",
    "$$ 预检机自动编程导出：坐标为零件坐标系，原点在前左上角，Z 向上为正",
  ]
  if (program.alignment?.primary && program.alignment.secondary && program.alignment.origin) {
    lines.push(
      `$$ 3-2-1 找正：${names.get(program.alignment.primary)} 定 Z，${names.get(program.alignment.secondary)} 定 X 方向与 Y 原点，${names.get(program.alignment.origin)} 定 X 原点`
    )
  }
  program.steps.forEach((step) => {
    const name = names.get(step.id)!
    const kind = step.kind === "point" ? "POINT" : step.kind.toUpperCase()
    lines.push(`$$ ${step.name}`)
    lines.push(featLine(step, name))
    lines.push(`MEAS/${kind},F(${name}),${step.points.length}`)
    for (const p of step.points) lines.push(`  PTMEAS/CART,${vec(p.nominal)},${vec(outward(p.approach))}`)
    lines.push("ENDMES")
  })
  lines.push("ENDFIL")
  return lines.join("\n")
}
