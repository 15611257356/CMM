import type { Vec3 } from "@/lib/geom"
import { applyDir, applyPoint, toPoseDeg, type RigidTransform } from "@/lib/math/transform"

/**
 * FANUC 风格 G 代码坐标改写（G17 平面、公制）。
 * 只改运动指令里的 X/Y/Z 和圆弧 I/J，进给、转速、刀补号、M 代码一律不动。
 * 变换只取绕 Z 旋转 + 平移：3 轴机床无法执行倾斜补偿，倾斜由上游单独告警。
 */

export type NcWarning = { line: number; message: string }

export type ToolpathPoint = { x: number; y: number; z: number; rapid: boolean }

export type NcTransformResult = {
  output: string
  warnings: NcWarning[]
  changedLines: number
  originalPath: ToolpathPoint[]
  newPath: ToolpathPoint[]
  /** 改写后程序在工件坐标系下的包络。 */
  bounds: { min: Vec3; max: Vec3 } | null
}

type Segment = { code: string; comment: boolean }

function splitComments(line: string): Segment[] {
  const segments: Segment[] = []
  let buf = ""
  let i = 0
  while (i < line.length) {
    const ch = line[i]
    if (ch === "(") {
      if (buf) segments.push({ code: buf, comment: false })
      const end = line.indexOf(")", i)
      const stop = end === -1 ? line.length : end + 1
      segments.push({ code: line.slice(i, stop), comment: true })
      buf = ""
      i = stop
      continue
    }
    if (ch === ";") {
      if (buf) segments.push({ code: buf, comment: false })
      segments.push({ code: line.slice(i), comment: true })
      return segments
    }
    buf += ch
    i++
  }
  if (buf) segments.push({ code: buf, comment: false })
  return segments
}

const WORD = /([A-Za-z])\s*([-+]?(?:\d+\.?\d*|\.\d+))/g

type Words = { letter: string; value: number; raw: string }[]

function parseWords(code: string): Words {
  const words: Words = []
  for (const m of code.matchAll(WORD)) {
    words.push({ letter: m[1].toUpperCase(), value: Number(m[2]), raw: m[0] })
  }
  return words
}

function gCodes(words: Words): number[] {
  return words.filter((w) => w.letter === "G").map((w) => w.value)
}

function fmt(v: number): string {
  const s = v.toFixed(4)
  return s === "-0.0000" ? "0.0000" : s
}

function sample(
  path: ToolpathPoint[],
  from: Vec3,
  to: Vec3,
  motion: number,
  center: { x: number; y: number } | null
) {
  if ((motion === 2 || motion === 3) && center) {
    const r = Math.hypot(from.x - center.x, from.y - center.y)
    const a0 = Math.atan2(from.y - center.y, from.x - center.x)
    let a1 = Math.atan2(to.y - center.y, to.x - center.x)
    if (motion === 2 && a1 >= a0) a1 -= Math.PI * 2
    if (motion === 3 && a1 <= a0) a1 += Math.PI * 2
    if (Math.abs(a1 - a0) < 1e-9) a1 = a0 + (motion === 3 ? 2 * Math.PI : -2 * Math.PI)
    const steps = Math.max(8, Math.ceil((Math.abs(a1 - a0) * r) / 2))
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      const a = a0 + (a1 - a0) * t
      path.push({
        x: center.x + r * Math.cos(a),
        y: center.y + r * Math.sin(a),
        z: from.z + (to.z - from.z) * t,
        rapid: false,
      })
    }
    return
  }
  path.push({ ...to, rapid: motion === 0 })
}

function arcCenterFromR(from: Vec3, to: Vec3, r: number, motion: number): { x: number; y: number } | null {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const d = Math.hypot(dx, dy)
  if (d < 1e-9 || Math.abs(r) < d / 2 - 1e-6) return null
  const h = Math.sqrt(Math.max(0, r * r - (d * d) / 4))
  const mx = (from.x + to.x) / 2
  const my = (from.y + to.y) / 2
  const sign = (motion === 2 ? 1 : -1) * (r > 0 ? 1 : -1)
  return { x: mx + (sign * h * dy) / d, y: my - (sign * h * dx) / d }
}

export function transformNcProgram(source: string, delta: RigidTransform): NcTransformResult {
  const pose = toPoseDeg(delta)
  const warnings: NcWarning[] = []
  const lines = source.replace(/\r\n?/g, "\n").split("\n")
  const out: string[] = []
  let changedLines = 0

  let absolute = true
  let motion = 0
  let plane = 17
  let canned = false
  let known = { x: false, y: false, z: false }
  const pos: Vec3 = { x: 0, y: 0, z: 0 }
  const originalPath: ToolpathPoint[] = []
  const newPath: ToolpathPoint[] = []
  let min: Vec3 | null = null
  let max: Vec3 | null = null
  const warnOnce = new Set<string>()

  const warn = (line: number, message: string, key?: string) => {
    if (key) {
      if (warnOnce.has(key)) return
      warnOnce.add(key)
    }
    warnings.push({ line, message })
  }

  const track = (p: Vec3) => {
    min = min ? { x: Math.min(min.x, p.x), y: Math.min(min.y, p.y), z: Math.min(min.z, p.z) } : { ...p }
    max = max ? { x: Math.max(max.x, p.x), y: Math.max(max.y, p.y), z: Math.max(max.z, p.z) } : { ...p }
  }

  lines.forEach((line, index) => {
    const lineNo = index + 1
    const segments = splitComments(line)
    const code = segments
      .filter((s) => !s.comment)
      .map((s) => s.code)
      .join(" ")
    if (/[#\[]|\b(IF|WHILE|GOTO|DO|END)\b/i.test(code)) {
      warn(lineNo, "含宏程序变量或跳转，未自动改写，请人工核对。")
      out.push(line)
      return
    }
    const words = parseWords(code)
    const gs = gCodes(words)

    for (const g of gs) {
      if (g === 90) absolute = true
      if (g === 91) absolute = false
      if (g === 17 || g === 18 || g === 19) plane = g
      if ([0, 1, 2, 3].includes(g)) {
        motion = g
        canned = false
      }
      if (g === 80) canned = false
      if (g === 73 || g === 74 || g === 76 || (g >= 81 && g <= 89)) canned = true
      if (g === 20) warn(lineNo, "程序为英制（G20），当前只支持公制，结果不可用。", "g20")
      if (g === 68) warn(lineNo, "程序已含 G68 坐标旋转，与自动改写叠加会出错，请先去掉。", "g68")
    }
    if (words.some((w) => w.letter === "M" && [98, 198].includes(w.value))) {
      warn(lineNo, "调用了子程序（M98/M198），子程序内的坐标不会被改写。")
    }

    const has = (l: string) => words.some((w) => w.letter === l)
    const get = (l: string) => words.find((w) => w.letter === l)?.value
    const hasAxis = has("X") || has("Y") || has("Z")

    const skipCodes = [4, 10, 28, 30, 52, 53, 92]
    const skip = gs.find((g) => skipCodes.includes(g))
    if (skip !== undefined) {
      if (skip === 53 || skip === 28 || skip === 30) {
        if (hasAxis) warn(lineNo, `G${skip} 为机械坐标/回参考点指令，未改写。`)
      } else if (skip !== 4) {
        warn(lineNo, `G${skip} 为坐标系设定指令，未改写，请人工确认。`)
      }
      out.push(line)
      return
    }
    if (!hasAxis) {
      out.push(line)
      return
    }
    if (plane !== 17 && (motion === 2 || motion === 3)) {
      warn(lineNo, `G${plane} 平面圆弧只改写端点，I/J/K 未处理，请人工核对。`, `plane${plane}`)
    }

    const from = { ...pos }
    const target: Vec3 = { ...pos }
    if (absolute) {
      if (has("X")) target.x = get("X")!
      if (has("Y")) target.y = get("Y")!
      if (has("Z")) target.z = get("Z")!
      if ((has("X") || has("Y")) && !(known.x && known.y) && !(has("X") && has("Y"))) {
        warn(lineNo, "首次定位只给了 X 或 Y 中的一个，旋转后另一轴按 0 计算，请确认。")
      }
      known = { x: known.x || has("X"), y: known.y || has("Y"), z: known.z || has("Z") }
    } else {
      target.x += get("X") ?? 0
      target.y += get("Y") ?? 0
      target.z += get("Z") ?? 0
    }

    let newXY: { x: number; y: number } | null = null
    let newZ: number | null = null
    let newIJ: { i: number; j: number } | null = null
    const newR = canned && absolute && has("R") ? get("R")! + pose.z : null
    if (absolute) {
      const mapped = applyPoint(delta, { x: target.x, y: target.y, z: 0 })
      if (has("X") || has("Y")) newXY = { x: mapped.x, y: mapped.y }
      if (has("Z")) newZ = target.z + pose.z
    } else {
      const d = applyDir(delta, { x: get("X") ?? 0, y: get("Y") ?? 0, z: 0 })
      if (has("X") || has("Y")) newXY = { x: d.x, y: d.y }
      if (has("Z")) newZ = get("Z")!
    }

    let center: { x: number; y: number } | null = null
    if (!canned && (motion === 2 || motion === 3) && plane === 17) {
      if (has("I") || has("J")) {
        const i = get("I") ?? 0
        const j = get("J") ?? 0
        center = { x: from.x + i, y: from.y + j }
        const d = applyDir(delta, { x: i, y: j, z: 0 })
        newIJ = { i: d.x, j: d.y }
      } else if (has("R")) {
        center = arcCenterFromR(from, target, get("R")!, motion)
      }
    }

    const rebuilt = segments
      .map((seg) => {
        if (seg.comment) return seg.code
        let text = seg.code
        let placedXY = false
        text = text.replace(WORD, (raw, letter: string) => {
          const L = letter.toUpperCase()
          if ((L === "X" || L === "Y") && newXY) {
            if (placedXY) return ""
            placedXY = true
            return `X${fmt(newXY.x)} Y${fmt(newXY.y)}`
          }
          if (L === "Z" && newZ !== null) return `Z${fmt(newZ)}`
          if (L === "R" && newR !== null) return `R${fmt(newR)}`
          if (L === "I" && newIJ) return `I${fmt(newIJ.i)}`
          if (L === "J" && newIJ) return `J${fmt(newIJ.j)}`
          return raw
        })
        if (newIJ && !/[Ii]\s*[-+.\d]/.test(seg.code)) text = text.replace(/(J[-\d.]+)/, `I${fmt(newIJ.i)} $1`)
        if (newIJ && !/[Jj]\s*[-+.\d]/.test(seg.code)) text = text.replace(/(I[-\d.]+)/, `$1 J${fmt(newIJ.j)}`)
        text = text.replace(/\s{2,}/g, " ")
        return /\s$/.test(seg.code) ? text : text.trimEnd()
      })
      .join("")

    if (rebuilt !== line) changedLines++
    out.push(rebuilt)

    sample(originalPath, from, target, motion, center)
    pos.x = target.x
    pos.y = target.y
    pos.z = target.z

    const mappedFrom = applyPoint(delta, { ...from, z: 0 })
    const mappedTo = applyPoint(delta, { ...target, z: 0 })
    const nf = { x: mappedFrom.x, y: mappedFrom.y, z: from.z + pose.z }
    const nt = { x: mappedTo.x, y: mappedTo.y, z: target.z + pose.z }
    const nc = center ? applyPoint(delta, { x: center.x, y: center.y, z: 0 }) : null
    const before = newPath.length
    sample(newPath, nf, nt, motion, nc ? { x: nc.x, y: nc.y } : null)
    for (let k = before; k < newPath.length; k++) track(newPath[k])
  })

  return {
    output: out.join("\n"),
    warnings,
    changedLines,
    originalPath,
    newPath,
    bounds: min && max ? { min, max } : null,
  }
}

/** 按机床行程检查改写后的程序（工件坐标 + 工件坐标系偏置 = 机械坐标）。 */
export function checkTravel(
  bounds: { min: Vec3; max: Vec3 } | null,
  offset: Vec3,
  travel: { min: Vec3; max: Vec3 }
): string[] {
  if (!bounds) return []
  const issues: string[] = []
  for (const axis of ["x", "y", "z"] as const) {
    const lo = bounds.min[axis] + offset[axis]
    const hi = bounds.max[axis] + offset[axis]
    if (lo < travel.min[axis]) issues.push(`${axis.toUpperCase()} 轴最小 ${lo.toFixed(3)} 低于行程下限 ${travel.min[axis]}`)
    if (hi > travel.max[axis]) issues.push(`${axis.toUpperCase()} 轴最大 ${hi.toFixed(3)} 超过行程上限 ${travel.max[axis]}`)
  }
  return issues
}

export const SAMPLE_NC = `%
O1001 (底板 精铣外形+钻孔 示例)
G21 G17 G40 G49 G80 G90
G54
T1 M06 (D10 立铣刀)
S3000 M03
G00 X-8. Y-8.
G43 Z30. H01
Z2.
G01 Z-5. F300
G41 D01 X0 Y0 F600
Y140.
X200.
Y0
X0
G40 X-8. Y-8.
G00 Z30.
T2 M06 (D10 钻头)
S1500 M03
G43 Z30. H02
G81 X40. Y30. Z-22. R2. F120
X160.
Y110.
X40.
G80
G00 X100. Y70.
G01 Z-2. F200
G02 X115. Y70. I7.5 J0 F400
G03 X100. Y70. R7.5
G00 Z30.
M30
%`
