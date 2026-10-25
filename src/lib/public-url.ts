/** public/ 里的文件。GitHub Pages 挂在 /CMM 下，本地开发没有前缀。 */
export function publicUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_BASE_PATH || ""
  const suffix = path.startsWith("/") ? path : `/${path}`
  return `${base}${suffix}`
}
