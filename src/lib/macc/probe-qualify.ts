import type { Vec3 } from "@/lib/geom"

/**
 * IPPServer 测针校验：激活父测针 → 设标准球参数 → 把探针球心移到球正上方约 10 mm → 定位标准球。
 * 换测针或测座后必须重新定位。
 */
export const SPHERE_LOCATE_CLEARANCE_MM = 10

export function sphereLocateStart(center: Vec3, radius: number): Vec3 {
  return { x: center.x, y: center.y, z: center.z + radius + SPHERE_LOCATE_CLEARANCE_MM }
}
