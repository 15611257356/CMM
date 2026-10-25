/** STL（二进制/ASCII）与 OBJ 解析，单位按 mm。 */

export function parseStl(buffer: ArrayBuffer): Float32Array {
  const bytes = new Uint8Array(buffer)
  if (bytes.length >= 84) {
    const view = new DataView(buffer)
    const count = view.getUint32(80, true)
    if (84 + count * 50 === bytes.length) {
      const out = new Float32Array(count * 9)
      for (let t = 0; t < count; t++) {
        const o = 84 + t * 50 + 12
        for (let k = 0; k < 9; k++) out[t * 9 + k] = view.getFloat32(o + k * 4, true)
      }
      return out
    }
  }
  const text = new TextDecoder().decode(bytes)
  if (!/\bvertex\b/i.test(text)) throw new Error("不是有效的 STL 文件")
  const values: number[] = []
  const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) values.push(Number(m[1]), Number(m[2]), Number(m[3]))
  if (values.length % 9 !== 0) throw new Error("STL 顶点数不是 3 的倍数")
  return new Float32Array(values)
}

export function parseObj(text: string): Float32Array {
  const verts: number[] = []
  const out: number[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith("v ")) {
      const [, x, y, z] = line.split(/\s+/)
      verts.push(Number(x), Number(y), Number(z))
    } else if (line.startsWith("f ")) {
      const idx = line
        .slice(2)
        .trim()
        .split(/\s+/)
        .map((tok) => {
          const i = parseInt(tok.split("/")[0], 10)
          return i < 0 ? verts.length / 3 + i : i - 1
        })
      for (let k = 1; k + 1 < idx.length; k++) {
        for (const i of [idx[0], idx[k], idx[k + 1]]) out.push(verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2])
      }
    }
  }
  if (!out.length) throw new Error("OBJ 里没有面")
  return new Float32Array(out)
}
