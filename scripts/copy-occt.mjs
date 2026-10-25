// Copies the OpenCascade wasm build into public/ so the STEP worker can load it.
import { copyFileSync, existsSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const src = join(root, "node_modules", "occt-import-js", "dist")
const dst = join(root, "public", "occt")

if (!existsSync(src)) {
  console.warn("occt-import-js not installed; STEP import will be unavailable")
  process.exit(0)
}
mkdirSync(dst, { recursive: true })
for (const file of ["occt-import-js.js", "occt-import-js.wasm"]) copyFileSync(join(src, file), join(dst, file))
