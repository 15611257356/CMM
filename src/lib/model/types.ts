import type { Vec3 } from "@/lib/geom"

export type ModelFormat = "step" | "iges" | "stl" | "obj"

/**
 * 导入的零件模型。坐标就是 CAD 坐标（mm），也是测量程序的零件坐标系，
 * 这样导出的 DMIS / I++ 测点可以直接和图纸对上。
 */
export type PartModel = {
  name: string
  format: ModelFormat
  /** 非索引三角形：每 9 个数一个三角形。 */
  positions: Float32Array
  /** 每个三角形所属的面。STEP/IGES 来自 B-rep 面，STL/OBJ 按法向连续性分区。 */
  faceOf: Int32Array
  faceCount: number
  faceSource: "brep" | "region"
  min: Vec3
  max: Vec3
}

export type FaceKind = "plane" | "cylinder" | "sphere" | "other"

export type FaceInfo = {
  id: number
  kind: FaceKind
  triangles: number[]
  area: number
  /** 平面：外法向（指向材料外侧）。 */
  normal?: Vec3
  /** 平面：面上一点；圆柱/球：中心。 */
  point?: Vec3
  /** 圆柱：轴向单位向量。 */
  axis?: Vec3
  radius?: number
  /** 圆柱：true 为孔（法向指向轴线）。 */
  inner?: boolean
  /** 圆柱：沿轴向的范围（相对 point）。 */
  axialMin?: number
  axialMax?: number
  /** 圆柱：实际覆盖的圆周角范围（弧度，起点与跨度）。 */
  arcStart?: number
  arcSpan?: number
  /** 拟合残差（mm）。 */
  residual: number
}

export type ModelOrientation = { rx: number; ry: number; rz: number }
