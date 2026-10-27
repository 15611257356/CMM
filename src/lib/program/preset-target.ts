/** 一键预调要跑哪一套程序。 */
export type PresetTarget = "picked" | "plate" | "need-picks"

/**
 * 模型上已经点出特征时，一键预调必须测量这些特征。
 * 没导入模型时，才生成夹具底板的预调程序。
 * 模型在、但还没选点时，不要偷偷换成底板程序。
 */
export function presetTarget(input: { hasModel: boolean; modelName?: string; stepCount: number }): PresetTarget {
  if (input.hasModel && input.modelName) return input.stepCount > 0 ? "picked" : "need-picks"
  return "plate"
}
