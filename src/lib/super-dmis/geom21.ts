import type { Vec3 } from "@/lib/geom"
import { add, cross, sub } from "@/lib/math/linalg"

/** 单轴在某个行程位置上的 6 项误差：3 平移（mm）+ 3 转角（rad）。 */
export type AxisErrorSample = {
  pos: number
  lin: Vec3
  rot: Vec3
}

export type AxisTable = AxisErrorSample[]

/**
 * X-Inspect 的 21 项几何误差：
 * 每轴 6 项（定位/直线度 + 滚转/俯仰/偏摆）× 3 轴 = 18，再加 XY/XZ/YZ 垂直度 3 项。
 * 分辨率是说明书里的「理论/实测」比例，默认 1。
 */
export type Geom21 = {
  resolution: Vec3
  /** 垂直度，弧度。Cxy 表示 Y 相对 X 的垂直度偏差。 */
  squareness: { xy: number; xz: number; yz: number }
  x: AxisTable
  y: AxisTable
  z: AxisTable
  source?: string
}

export function emptyGeom21(): Geom21 {
  return {
    resolution: { x: 1, y: 1, z: 1 },
    squareness: { xy: 0, xz: 0, yz: 0 },
    x: [],
    y: [],
    z: [],
  }
}

export function geom21IsIdentity(g: Geom21): boolean {
  const r = g.resolution
  const s = g.squareness
  if (Math.abs(r.x - 1) + Math.abs(r.y - 1) + Math.abs(r.z - 1) > 1e-12) return false
  if (Math.abs(s.xy) + Math.abs(s.xz) + Math.abs(s.yz) > 1e-12) return false
  const nonempty = (t: AxisTable) => t.some((p) => Math.hypot(p.lin.x, p.lin.y, p.lin.z, p.rot.x, p.rot.y, p.rot.z) > 1e-12)
  return !nonempty(g.x) && !nonempty(g.y) && !nonempty(g.z)
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

function interpolateTable(table: AxisTable, pos: number): { lin: Vec3; rot: Vec3 } {
  if (!table.length) return { lin: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } }
  const sorted = [...table].sort((a, b) => a.pos - b.pos)
  if (pos <= sorted[0].pos) return { lin: sorted[0].lin, rot: sorted[0].rot }
  const last = sorted[sorted.length - 1]
  if (pos >= last.pos) return { lin: last.lin, rot: last.rot }
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]
    const b = sorted[i + 1]
    if (pos >= a.pos && pos <= b.pos) {
      const t = b.pos === a.pos ? 0 : (pos - a.pos) / (b.pos - a.pos)
      return {
        lin: { x: lerp(a.lin.x, b.lin.x, t), y: lerp(a.lin.y, b.lin.y, t), z: lerp(a.lin.z, b.lin.z, t) },
        rot: { x: lerp(a.rot.x, b.rot.x, t), y: lerp(a.rot.y, b.rot.y, t), z: lerp(a.rot.z, b.rot.z, t) },
      }
    }
  }
  return { lin: last.lin, rot: last.rot }
}

/**
 * XYZ 串联小角度模型给出指示坐标相对真值的偏差（mm）。
 * 垂直度按小角度加在后一轴上；转角按刚体 ω×r 作用到后续轴坐标。
 */
export function volumetricError(g: Geom21, p: Vec3): Vec3 {
  const ex = interpolateTable(g.x, p.x)
  const ey = interpolateTable(g.y, p.y)
  const ez = interpolateTable(g.z, p.z)
  const trans = add(add(ex.lin, ey.lin), ez.lin)
  const omega = add(add(ex.rot, ey.rot), ez.rot)
  const abbe = cross(omega, p)
  return {
    x: trans.x + abbe.x + g.squareness.xy * p.y + g.squareness.xz * p.z,
    y: trans.y + abbe.y + g.squareness.yz * p.z,
    z: trans.z + abbe.z,
  }
}

/**
 * 把光栅指示坐标还原成补偿后的机床坐标。
 * 分辨率按说明书：真值 = 指示值 ×（理论/实测）。
 * 非线性表存的是「实测 − 真值」，所以再减去体积误差。
 */
export function compensatePoint(g: Geom21, indicated: Vec3): Vec3 {
  const scaled = {
    x: indicated.x * g.resolution.x,
    y: indicated.y * g.resolution.y,
    z: indicated.z * g.resolution.z,
  }
  return sub(scaled, volumetricError(g, scaled))
}
