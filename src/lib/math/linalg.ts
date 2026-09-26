import type { Vec3 } from "@/lib/geom"

export function vec(x: number, y: number, z: number): Vec3 {
  return { x, y, z }
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

export function scale(a: Vec3, k: number): Vec3 {
  return { x: a.x * k, y: a.y * k, z: a.z * k }
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

export function norm(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z)
}

export function normalize(a: Vec3): Vec3 {
  const n = norm(a)
  if (n < 1e-12) throw new Error("零向量无法归一化")
  return scale(a, 1 / n)
}

export function centroid(points: Vec3[]): Vec3 {
  if (!points.length) throw new Error("点集为空")
  let x = 0,
    y = 0,
    z = 0
  for (const p of points) {
    x += p.x
    y += p.y
    z += p.z
  }
  const n = points.length
  return { x: x / n, y: y / n, z: z / n }
}

/** 去掉 a 在单位向量 n 上的分量。 */
export function rejectFrom(a: Vec3, n: Vec3): Vec3 {
  return sub(a, scale(n, dot(a, n)))
}

/** 任取一对与 n 正交的单位向量 (u, v)，满足 u × v = n。 */
export function orthonormalBasis(n: Vec3): { u: Vec3; v: Vec3 } {
  const helper = Math.abs(n.x) < 0.9 ? vec(1, 0, 0) : vec(0, 1, 0)
  const u = normalize(rejectFrom(helper, n))
  const v = cross(n, u)
  return { u, v }
}

/** 行主序 3×3 矩阵。 */
export type Mat3 = [number, number, number, number, number, number, number, number, number]

export function identity3(): Mat3 {
  return [1, 0, 0, 0, 1, 0, 0, 0, 1]
}

export function mat3FromColumns(c0: Vec3, c1: Vec3, c2: Vec3): Mat3 {
  return [c0.x, c1.x, c2.x, c0.y, c1.y, c2.y, c0.z, c1.z, c2.z]
}

export function mat3Column(m: Mat3, index: 0 | 1 | 2): Vec3 {
  return { x: m[index], y: m[3 + index], z: m[6 + index] }
}

export function mat3MulVec(m: Mat3, p: Vec3): Vec3 {
  return {
    x: m[0] * p.x + m[1] * p.y + m[2] * p.z,
    y: m[3] * p.x + m[4] * p.y + m[5] * p.z,
    z: m[6] * p.x + m[7] * p.y + m[8] * p.z,
  }
}

export function mat3Mul(a: Mat3, b: Mat3): Mat3 {
  const out = new Array<number>(9)
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]
    }
  }
  return out as Mat3
}

export function transpose3(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]
}

/** 绕 X、Y、Z 轴旋转（弧度），组合顺序 R = Rz · Ry · Rx。 */
export function rotationZYX(rz: number, ry: number, rx: number): Mat3 {
  const [cz, sz] = [Math.cos(rz), Math.sin(rz)]
  const [cy, sy] = [Math.cos(ry), Math.sin(ry)]
  const [cx, sx] = [Math.cos(rx), Math.sin(rx)]
  return [
    cz * cy,
    cz * sy * sx - sz * cx,
    cz * sy * cx + sz * sx,
    sz * cy,
    sz * sy * sx + cz * cx,
    sz * sy * cx - cz * sx,
    -sy,
    cy * sx,
    cy * cx,
  ]
}

/** rotationZYX 的逆分解，返回弧度。 */
export function eulerZYX(m: Mat3): { rz: number; ry: number; rx: number } {
  const ry = -Math.asin(Math.max(-1, Math.min(1, m[6])))
  const rx = Math.atan2(m[7], m[8])
  const rz = Math.atan2(m[3], m[0])
  return { rz, ry, rx }
}

/** 对称 3×3 矩阵的 Jacobi 特征分解，特征值升序。 */
export function symmetricEigen3(input: number[][]): { values: number[]; vectors: Vec3[] } {
  const a = input.map((row) => [...row])
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]
  for (let sweep = 0; sweep < 64; sweep++) {
    const off = a[0][1] ** 2 + a[0][2] ** 2 + a[1][2] ** 2
    if (off < 1e-30) break
    for (let p = 0; p < 2; p++) {
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q])
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(t * t + 1)
        const s = t * c
        for (let k = 0; k < 3; k++) {
          const akp = a[k][p]
          const akq = a[k][q]
          a[k][p] = c * akp - s * akq
          a[k][q] = s * akp + c * akq
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p][k]
          const aqk = a[q][k]
          a[p][k] = c * apk - s * aqk
          a[q][k] = s * apk + c * aqk
        }
        for (let k = 0; k < 3; k++) {
          const vkp = v[k][p]
          const vkq = v[k][q]
          v[k][p] = c * vkp - s * vkq
          v[k][q] = s * vkp + c * vkq
        }
      }
    }
  }
  const pairs = [0, 1, 2].map((i) => ({
    value: a[i][i],
    vector: vec(v[0][i], v[1][i], v[2][i]),
  }))
  pairs.sort((l, r) => l.value - r.value)
  return { values: pairs.map((p) => p.value), vectors: pairs.map((p) => p.vector) }
}

/** 部分主元高斯消元，奇异时返回 null。 */
export function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length
  const m = A.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row
    }
    if (Math.abs(m[pivot][col]) < 1e-14) return null
    ;[m[col], m[pivot]] = [m[pivot], m[col]]
    const div = m[col][col]
    for (let j = col; j <= n; j++) m[col][j] /= div
    for (let row = 0; row < n; row++) {
      if (row === col) continue
      const f = m[row][col]
      if (f === 0) continue
      for (let j = col; j <= n; j++) m[row][j] -= f * m[col][j]
    }
  }
  return m.map((row) => row[n])
}

/** 点集协方差矩阵（未除以 n）。 */
export function scatterMatrix(points: Vec3[], center: Vec3): number[][] {
  const s = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  for (const p of points) {
    const d = [p.x - center.x, p.y - center.y, p.z - center.z]
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) s[i][j] += d[i] * d[j]
  }
  return s
}
