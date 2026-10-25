import type { Vec3 } from "@/lib/geom"
import type { ModelFormat, PartModel } from "@/lib/model/types"

export function triangleCount(model: Pick<PartModel, "positions">): number {
  return model.positions.length / 9
}

export function triVertex(positions: Float32Array, tri: number, corner: 0 | 1 | 2): Vec3 {
  const o = tri * 9 + corner * 3
  return { x: positions[o], y: positions[o + 1], z: positions[o + 2] }
}

/** 三角形外法向（右手顺序）与面积。退化三角形法向为 0。 */
export function triNormalArea(positions: Float32Array, tri: number): { n: Vec3; area: number } {
  const o = tri * 9
  const ax = positions[o + 3] - positions[o]
  const ay = positions[o + 4] - positions[o + 1]
  const az = positions[o + 5] - positions[o + 2]
  const bx = positions[o + 6] - positions[o]
  const by = positions[o + 7] - positions[o + 1]
  const bz = positions[o + 8] - positions[o + 2]
  const cx = ay * bz - az * by
  const cy = az * bx - ax * bz
  const cz = ax * by - ay * bx
  const len = Math.hypot(cx, cy, cz)
  if (len < 1e-14) return { n: { x: 0, y: 0, z: 0 }, area: 0 }
  return { n: { x: cx / len, y: cy / len, z: cz / len }, area: len / 2 }
}

function bounds(positions: Float32Array): { min: Vec3; max: Vec3 } {
  const min = { x: Infinity, y: Infinity, z: Infinity }
  const max = { x: -Infinity, y: -Infinity, z: -Infinity }
  for (let i = 0; i < positions.length; i += 3) {
    min.x = Math.min(min.x, positions[i])
    min.y = Math.min(min.y, positions[i + 1])
    min.z = Math.min(min.z, positions[i + 2])
    max.x = Math.max(max.x, positions[i])
    max.y = Math.max(max.y, positions[i + 1])
    max.z = Math.max(max.z, positions[i + 2])
  }
  return { min, max }
}

function vertexKey(positions: Float32Array, i: number, q: number): string {
  return `${Math.round(positions[i] / q)},${Math.round(positions[i + 1] / q)},${Math.round(positions[i + 2] / q)}`
}

/** 焊接重合顶点，返回每个三角形三个角的顶点编号。 */
export function weldCorners(positions: Float32Array, tolerance = 1e-4): Int32Array {
  const ids = new Map<string, number>()
  const corners = new Int32Array(positions.length / 3)
  for (let c = 0; c < corners.length; c++) {
    const key = vertexKey(positions, c * 3, tolerance)
    let id = ids.get(key)
    if (id === undefined) {
      id = ids.size
      ids.set(key, id)
    }
    corners[c] = id
  }
  return corners
}

/**
 * 没有 B-rep 面信息（STL/OBJ）时按相邻三角形法向夹角分区：
 * 夹角小于阈值视为同一光滑面，所以圆柱孔壁会成为一个面，平面与侧壁在棱边处分开。
 */
export function segmentFacesByNormal(positions: Float32Array, maxAngleDeg = 15): { faceOf: Int32Array; faceCount: number } {
  const tris = positions.length / 9
  const corners = weldCorners(positions)
  const edgeTris = new Map<string, number[]>()
  for (let t = 0; t < tris; t++) {
    for (let k = 0; k < 3; k++) {
      const a = corners[t * 3 + k]
      const b = corners[t * 3 + ((k + 1) % 3)]
      const key = a < b ? `${a}_${b}` : `${b}_${a}`
      const list = edgeTris.get(key)
      if (list) list.push(t)
      else edgeTris.set(key, [t])
    }
  }
  const normals = Array.from({ length: tris }, (_, t) => triNormalArea(positions, t).n)
  const cosMax = Math.cos((maxAngleDeg * Math.PI) / 180)
  const faceOf = new Int32Array(tris).fill(-1)
  let faceCount = 0
  for (let seed = 0; seed < tris; seed++) {
    if (faceOf[seed] >= 0) continue
    const face = faceCount++
    faceOf[seed] = face
    const stack = [seed]
    while (stack.length) {
      const t = stack.pop()!
      for (let k = 0; k < 3; k++) {
        const a = corners[t * 3 + k]
        const b = corners[t * 3 + ((k + 1) % 3)]
        const key = a < b ? `${a}_${b}` : `${b}_${a}`
        for (const u of edgeTris.get(key) ?? []) {
          if (faceOf[u] >= 0) continue
          const n0 = normals[t]
          const n1 = normals[u]
          if (n0.x * n1.x + n0.y * n1.y + n0.z * n1.z < cosMax) continue
          faceOf[u] = face
          stack.push(u)
        }
      }
    }
  }
  return { faceOf, faceCount }
}

export function buildModel(
  name: string,
  format: ModelFormat,
  positions: Float32Array,
  brepFaces?: { faceOf: Int32Array; faceCount: number }
): PartModel {
  if (positions.length < 9 || positions.length % 9 !== 0) throw new Error("模型里没有三角面")
  const { min, max } = bounds(positions)
  if (![min.x, min.y, min.z, max.x, max.y, max.z].every(Number.isFinite)) throw new Error("模型坐标无效")
  const faces = brepFaces ?? segmentFacesByNormal(positions)
  return {
    name,
    format,
    positions,
    faceOf: faces.faceOf,
    faceCount: faces.faceCount,
    faceSource: brepFaces ? "brep" : "region",
    min,
    max,
  }
}

export function trianglesOfFace(model: PartModel, face: number): number[] {
  const out: number[] = []
  for (let t = 0; t < model.faceOf.length; t++) if (model.faceOf[t] === face) out.push(t)
  return out
}

/** 索引网格展开为非索引三角形。 */
export function expandIndexed(vertices: ArrayLike<number>, index: ArrayLike<number>): Float32Array {
  const out = new Float32Array(index.length * 3)
  for (let i = 0; i < index.length; i++) {
    const v = index[i] * 3
    out[i * 3] = vertices[v]
    out[i * 3 + 1] = vertices[v + 1]
    out[i * 3 + 2] = vertices[v + 2]
  }
  return out
}
