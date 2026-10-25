import type { Vec3 } from "@/lib/geom"
import { mat3MulVec } from "@/lib/math/linalg"
import { applyPoint, fromPoseDeg, type RigidTransform } from "@/lib/math/transform"
import type { ModelOrientation, PartModel } from "@/lib/model/types"

function rotatedBounds(model: PartModel, T: RigidTransform): { min: Vec3; max: Vec3 } {
  const min = { x: Infinity, y: Infinity, z: Infinity }
  const max = { x: -Infinity, y: -Infinity, z: -Infinity }
  const p = model.positions
  for (let i = 0; i < p.length; i += 3) {
    const q = applyPoint(T, { x: p[i], y: p[i + 1], z: p[i + 2] })
    min.x = Math.min(min.x, q.x)
    min.y = Math.min(min.y, q.y)
    min.z = Math.min(min.z, q.z)
    max.x = Math.max(max.x, q.x)
    max.y = Math.max(max.y, q.y)
    max.z = Math.max(max.z, q.z)
  }
  return { min, max }
}

/**
 * 名义装夹：按选定朝向摆放，包围盒底面落在托盘上表面、XY 居中。
 * 零件坐标仍是 CAD 坐标，所以测点、DMIS 与图纸一致。
 */
export function modelOnPallet(model: PartModel, o: ModelOrientation): RigidTransform {
  const R = fromPoseDeg({ x: 0, y: 0, z: 0, rz: o.rz, ry: o.ry, rx: o.rx })
  const { min, max } = rotatedBounds(model, R)
  const t = { x: -(min.x + max.x) / 2, y: -(min.y + max.y) / 2, z: -min.z }
  return { r: R.r, t: t }
}

export function modelBoundsIn(model: PartModel, partToFrame: RigidTransform): { min: Vec3; max: Vec3 } {
  return rotatedBounds(model, partToFrame)
}

export function modelSize(model: PartModel, o: ModelOrientation): Vec3 {
  const R = fromPoseDeg({ x: 0, y: 0, z: 0, rz: o.rz, ry: o.ry, rx: o.rx })
  const { min, max } = rotatedBounds(model, R)
  return { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z }
}

export function rotateDir(T: RigidTransform, d: Vec3): Vec3 {
  return mat3MulVec(T.r, d)
}
