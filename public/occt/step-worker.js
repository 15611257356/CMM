/* global importScripts, occtimportjs */
importScripts("/occt/occt-import-js.js")

let occtReady = null

onmessage = async function (ev) {
  try {
    if (!occtReady) occtReady = occtimportjs({ locateFile: (path) => "/occt/" + path })
    const occt = await occtReady
    const { format, buffer, params } = ev.data
    const result = format === "iges" ? occt.ReadIgesFile(buffer, params) : occt.ReadStepFile(buffer, params)
    postMessage(result)
  } catch (error) {
    postMessage({ success: false, meshes: [], error: String(error) })
  }
}
