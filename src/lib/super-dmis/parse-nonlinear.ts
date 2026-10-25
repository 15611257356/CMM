import type { Vec3 } from "@/lib/geom"
import { emptyGeom21, type AxisTable, type Geom21 } from "@/lib/super-dmis/geom21"
import { numbersIn, splitFields, stripBom } from "@/lib/super-dmis/parse-text"

const AXIS_LINE = /^(?:AXIS\s*[/=:]?\s*)?([XYZ])(?:AXIS)?$/i

function axisKey(token: string): "x" | "y" | "z" | null {
  const m = token.trim().match(AXIS_LINE)
  if (!m) return null
  return m[1].toLowerCase() as "x" | "y" | "z"
}

/** 转角：绝对值大于 0.05 时按 µrad（说明书旋转误差 ×10^6）；否则按弧度。 */
export function toRadians(value: number): number {
  return Math.abs(value) > 0.05 ? value * 1e-6 : value
}

/** 垂直度：绝对值大于 0.01 时按 X-Inspect 的 ×10^7 存储单位。 */
export function squarenessToRad(value: number): number {
  return Math.abs(value) > 0.01 ? value * 1e-7 : value
}

function sampleFromNums(nums: number[]): { pos: number; lin: Vec3; rot: Vec3 } | null {
  if (nums.length < 4) return null
  const pos = nums[0]
  const lin = { x: nums[1], y: nums[2], z: nums[3] }
  const rot = {
    x: toRadians(nums[4] ?? 0),
    y: toRadians(nums[5] ?? 0),
    z: toRadians(nums[6] ?? 0),
  }
  return { pos, lin, rot }
}

function looksLikeHeader(fields: string[]): boolean {
  const joined = fields.join(" ").toLowerCase()
  return joined.includes("pos") && (joined.includes("lin") || joined.includes("exx") || joined.includes("error"))
}

/**
 * 读取 X-Inspect 非线性表。
 * - RationalDMIS：`AXIS/X` 后跟 `pos linX linY linZ rotX rotY rotZ`
 * - Other：CSV/TSV，表头含 pos,linX,linY,linZ,rotX,rotY,rotZ，可带 axis 列
 */
export function parseNonlinear(text: string, filename = ""): Geom21 {
  const g = emptyGeom21()
  g.source = filename || "nonlinear"
  const lines = stripBom(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("$$") && !l.startsWith("#") && !l.startsWith("//"))

  let current: "x" | "y" | "z" | null = null
  let header: string[] | null = null

  for (const line of lines) {
    const lower = line.toLowerCase()
    if (lower.startsWith("res") || lower.startsWith("resolution")) {
      const n = numbersIn(line)
      if (n.length >= 3) g.resolution = { x: n[0], y: n[1], z: n[2] }
      continue
    }
    if (lower.includes("square") || lower.includes("vert") || lower.includes("cxy") || /垂直/.test(line)) {
      const n = numbersIn(line)
      if (n.length >= 3) {
        g.squareness = { xy: squarenessToRad(n[0]), xz: squarenessToRad(n[1]), yz: squarenessToRad(n[2]) }
      }
      continue
    }

    const fields = splitFields(line)
    if (!fields.length) continue

    const asAxis = axisKey(fields[0])
    if (asAxis && (fields.length === 1 || (fields.length === 2 && /axis/i.test(fields[1])))) {
      current = asAxis
      header = null
      continue
    }
    if (asAxis && fields.length >= 5) {
      current = asAxis
      const sample = sampleFromNums(numbersIn(line.replace(/^[XYZ][A-Z/=:\s]*/i, "")))
      if (sample) g[current].push(sample)
      continue
    }

    if (looksLikeHeader(fields) || fields.some((f) => /^axis$/i.test(f))) {
      header = fields.map((f) => f.toLowerCase())
      continue
    }

    if (header) {
      const idx = (name: string) => header!.findIndex((h) => h === name || h.replace(/[^a-z]/g, "") === name)
      const axisIdx = idx("axis")
      const posIdx = header.findIndex((h) => h === "pos" || h === "position")
      const get = (names: string[], fallback: number) => {
        for (const n of names) {
          const i = idx(n)
          if (i >= 0 && fields[i] !== undefined) {
            const v = Number(fields[i])
            if (Number.isFinite(v)) return v
          }
        }
        return fallback
      }
      let axis: "x" | "y" | "z" | null = current
      if (axisIdx >= 0) axis = axisKey(fields[axisIdx])
      if (!axis) continue
      const nums = numbersIn(line)
      const pos = posIdx >= 0 ? Number(fields[posIdx]) : nums[0]
      if (!Number.isFinite(pos)) continue
      g[axis].push({
        pos,
        lin: { x: get(["linx", "exx"], nums[1] ?? 0), y: get(["liny", "eyx"], nums[2] ?? 0), z: get(["linz", "ezx"], nums[3] ?? 0) },
        rot: {
          x: toRadians(get(["rotx", "eax"], nums[4] ?? 0)),
          y: toRadians(get(["roty", "ebx"], nums[5] ?? 0)),
          z: toRadians(get(["rotz", "ecx"], nums[6] ?? 0)),
        },
      })
      continue
    }

    const nums = numbersIn(line)
    const sample = sampleFromNums(nums)
    if (sample && current) g[current].push(sample)
  }

  if (!g.x.length && !g.y.length && !g.z.length) {
    throw new Error("非线性文件里没有读到 pos/linX/linY/linZ 数据。请导出 X-Inspect 的 Other CSV 或 RationalDMIS 补偿表")
  }
  return g
}

export function tableSummary(table: AxisTable): string {
  if (!table.length) return "空"
  return `${table.length} 点，${table[0].pos.toFixed(1)}–${table[table.length - 1].pos.toFixed(1)} mm`
}
