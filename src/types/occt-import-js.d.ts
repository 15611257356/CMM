declare module "occt-import-js" {
  type OcctModule = {
    ReadStepFile(content: Uint8Array, params: unknown): import("@/lib/model/occt").OcctResult
    ReadIgesFile(content: Uint8Array, params: unknown): import("@/lib/model/occt").OcctResult
  }
  const occtimportjs: (options?: { locateFile?: (path: string) => string }) => Promise<OcctModule>
  export default occtimportjs
}
