import { numbersIn, stripBom } from "@/lib/super-dmis/parse-text"

/** 步距规真值：名义长度 mm，偏差 µm。 */
export type StepGaugeTruth = {
  segments: { nominalMm: number; deviationUm: number; actualMm: number }[]
}

/**
 * X-Inspect 说明书：真值文件后缀 .dat，ANSI，每行「理论值 mm，偏差值 µ」。
 */
export function parseStepGaugeDat(text: string): StepGaugeTruth {
  const segments: StepGaugeTruth["segments"] = []
  for (const raw of stripBom(text).split(/\r?\n/)) {
    const nums = numbersIn(raw)
    if (nums.length < 2) continue
    const nominalMm = nums[0]
    const deviationUm = nums[1]
    segments.push({ nominalMm, deviationUm, actualMm: nominalMm + deviationUm / 1000 })
  }
  if (!segments.length) throw new Error("步距规真值文件里没有「名义 mm, 偏差 µm」数据行")
  return { segments }
}
