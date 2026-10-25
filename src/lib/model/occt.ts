import { buildModel, expandIndexed } from "@/lib/model/mesh"
import type { ModelFormat, PartModel } from "@/lib/model/types"

export type OcctMesh = {
  name?: string
  attributes: { position: { array: ArrayLike<number> } }
  index: { array: ArrayLike<number> }
  brep_faces: { first: number; last: number }[]
}

export type OcctResult = { success: boolean; meshes: OcctMesh[] }

/** 三角化精度：弦高 0.01 mm，孔径拟合的离散误差远小于测针重复性。 */
export const OCCT_PARAMS = {
  linearUnit: "millimeter",
  linearDeflectionType: "absolute_value",
  linearDeflection: 0.01,
  angularDeflection: 0.08,
} as const

/** occt-import-js 的结果：每个 B-rep 面保留为一个可点选的面。 */
export function modelFromOcct(name: string, format: ModelFormat, result: OcctResult): PartModel {
  if (!result.success || !result.meshes?.length) throw new Error("STEP/IGES 解析失败：文件里没有实体")
  let total = 0
  for (const mesh of result.meshes) total += mesh.index.array.length / 3
  const positions = new Float32Array(total * 9)
  const faceOf = new Int32Array(total).fill(-1)
  let triBase = 0
  let faceBase = 0
  for (const mesh of result.meshes) {
    const tri = expandIndexed(mesh.attributes.position.array, mesh.index.array)
    positions.set(tri, triBase * 9)
    const count = mesh.index.array.length / 3
    mesh.brep_faces.forEach((f, i) => {
      for (let t = f.first; t <= f.last && t < count; t++) faceOf[triBase + t] = faceBase + i
    })
    faceBase += mesh.brep_faces.length
    for (let t = 0; t < count; t++) if (faceOf[triBase + t] < 0) faceOf[triBase + t] = faceBase++
    triBase += count
  }
  return buildModel(name, format, positions, { faceOf, faceCount: faceBase })
}
