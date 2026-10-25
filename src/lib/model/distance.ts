import type { Vec3 } from "@/lib/geom"
import type { PartModel } from "@/lib/model/types"
import { BufferAttribute, BufferGeometry, DoubleSide, Ray, Vector3 } from "three"
import { MeshBVH } from "three-mesh-bvh"

/**
 * 零件表面的距离查询（零件坐标）。无符号距离：测针从外部逼近时足够做球面追踪，
 * 线段碰撞检查按 0.5 mm 步长采样，穿过表面时一定会有采样点落在测针半径以内。
 */
export type ModelDistance = {
  distance(p: Vec3, cap?: number): number
  /** 从 origin 沿单位方向射线第一次碰到表面的距离，没碰到返回 null。 */
  raycast(origin: Vec3, dir: Vec3, far?: number): number | null
}

const DISTANCE_CAP = 80

export function createModelDistance(model: PartModel): ModelDistance {
  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new BufferAttribute(model.positions.slice(), 3))
  const bvh = new MeshBVH(geometry)
  const q = new Vector3()
  const target = { point: new Vector3(), distance: 0, faceIndex: 0 }
  const ray = new Ray()
  return {
    distance(p, cap = DISTANCE_CAP) {
      q.set(p.x, p.y, p.z)
      const hit = bvh.closestPointToPoint(q, target, 0, cap)
      return hit ? hit.distance : cap
    },
    raycast(origin, dir, far = Infinity) {
      ray.origin.set(origin.x, origin.y, origin.z)
      ray.direction.set(dir.x, dir.y, dir.z)
      const hit = bvh.raycastFirst(ray, DoubleSide, 0, far)
      return hit ? hit.distance : null
    },
  }
}
