/* global importScripts, occtimportjs */
// 页面可能挂在 /CMM 这类子路径下，按 worker 自己的地址找 wasm。
const base = self.location.pathname.replace(/\/occt\/step-worker\.js$/, "")
importScripts(`${base}/occt/occt-import-js.js`)

let occtReady = null

onmessage = async function (ev) {
  try {
    if (!occtReady) occtReady = occtimportjs({ locateFile: (path) => `${base}/occt/${path}` })
    const occt = await occtReady
    const { format, buffer, params } = ev.data
    const result = format === "iges" ? occt.ReadIgesFile(buffer, params) : occt.ReadStepFile(buffer, params)
    postMessage(result)
  } catch (error) {
    postMessage({ success: false, meshes: [], error: String(error) })
  }
}
