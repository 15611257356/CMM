/** 把逗号/分号/空白分隔的一行拆成数字，忽略 $$ 注释。 */
export function splitFields(line: string): string[] {
  const cut = line.replace(/\$\$.*$/, "").replace(/#.*$/, "").trim()
  if (!cut) return []
  return cut
    .split(/[,;\t ]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function parseNumber(raw: string): number | null {
  const m = raw.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/)
  if (!m) return null
  const v = Number(m[0])
  return Number.isFinite(v) ? v : null
}

export function numbersIn(line: string): number[] {
  return splitFields(line)
    .map(parseNumber)
    .filter((n): n is number => n !== null)
}

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}
