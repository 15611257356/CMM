import type { Vec3 } from "@/lib/geom"
import {
  add,
  eulerZYX,
  identity3,
  mat3FromColumns,
  mat3Mul,
  mat3MulVec,
  rotationZYX,
  scale,
  transpose3,
  type Mat3,
} from "@/lib/math/linalg"

/** 刚体变换：p_parent = r · p_local + t。 */
export type RigidTransform = { r: Mat3; t: Vec3 }

export function identityTransform(): RigidTransform {
  return { r: identity3(), t: { x: 0, y: 0, z: 0 } }
}

export function applyPoint(T: RigidTransform, p: Vec3): Vec3 {
  return add(mat3MulVec(T.r, p), T.t)
}

export function applyDir(T: RigidTransform, d: Vec3): Vec3 {
  return mat3MulVec(T.r, d)
}

/** 先做 b，再做 a。 */
export function compose(a: RigidTransform, b: RigidTransform): RigidTransform {
  return { r: mat3Mul(a.r, b.r), t: applyPoint(a, b.t) }
}

export function invert(T: RigidTransform): RigidTransform {
  const rt = transpose3(T.r)
  return { r: rt, t: scale(mat3MulVec(rt, T.t), -1) }
}

/** 局部坐标系的三根轴与原点（均在父坐标系下表示）。 */
export function fromAxes(origin: Vec3, xAxis: Vec3, yAxis: Vec3, zAxis: Vec3): RigidTransform {
  return { r: mat3FromColumns(xAxis, yAxis, zAxis), t: { ...origin } }
}

export type PoseDeg = { x: number; y: number; z: number; rz: number; ry: number; rx: number }

const DEG = Math.PI / 180

export function fromPoseDeg(pose: PoseDeg): RigidTransform {
  return {
    r: rotationZYX(pose.rz * DEG, pose.ry * DEG, pose.rx * DEG),
    t: { x: pose.x, y: pose.y, z: pose.z },
  }
}

export function toPoseDeg(T: RigidTransform): PoseDeg {
  const { rz, ry, rx } = eulerZYX(T.r)
  return { x: T.t.x, y: T.t.y, z: T.t.z, rz: rz / DEG, ry: ry / DEG, rx: rx / DEG }
}

export function translation(t: Vec3): RigidTransform {
  return { r: identity3(), t: { ...t } }
}
