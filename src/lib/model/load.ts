import { buildModel } from "@/lib/model/mesh"
import { modelFromOcct, OCCT_PARAMS, type OcctResult } from "@/lib/model/occt"
import { parseObj, parseStl } from "@/lib/model/parse-mesh"
import type { ModelFormat, PartModel } from "@/lib/model/types"
import { publicUrl } from "@/lib/public-url"

export const MODEL_ACCEPT = ".step,.stp,.iges,.igs,.stl,.obj"

export function modelFormatOf(filename: string): ModelFormat | null {
  const ext = filename.toLowerCase().split(".").pop() ?? ""
  if (ext === "step" || ext === "stp") return "step"
  if (ext === "iges" || ext === "igs") return "iges"
  if (ext === "stl") return "stl"
  if (ext === "obj") return "obj"
  return null
}

/** OpenCascade（wasm）在 Worker 里三角化，避免大模型卡住界面。 */
function readBrepInWorker(format: "step" | "iges", buffer: ArrayBuffer): Promise<OcctResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(publicUrl("/occt/step-worker.js"))
    const timer = setTimeout(() => {
      worker.terminate()
      reject(new Error("STEP 解析超时（60 s）"))
    }, 60000)
    worker.onmessage = (ev: MessageEvent<OcctResult>) => {
      clearTimeout(timer)
      worker.terminate()
      resolve(ev.data)
    }
    worker.onerror = (ev) => {
      clearTimeout(timer)
      worker.terminate()
      reject(new Error(`STEP 解析器加载失败：${ev.message || "请确认 /occt/ 下的 wasm 已部署"}`))
    }
    worker.postMessage({ format, buffer: new Uint8Array(buffer), params: OCCT_PARAMS })
  })
}

export async function parseModelBuffer(name: string, buffer: ArrayBuffer): Promise<PartModel> {
  const format = modelFormatOf(name)
  if (!format) throw new Error(`不支持的模型格式：${name}。请用 STEP / IGES / STL / OBJ`)
  if (format === "step" || format === "iges") {
    return modelFromOcct(name, format, await readBrepInWorker(format, buffer))
  }
  const positions = format === "stl" ? parseStl(buffer) : parseObj(new TextDecoder().decode(buffer))
  return buildModel(name, format, positions)
}
