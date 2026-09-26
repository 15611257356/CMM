/**
 * 温度补偿：零件按线膨胀系数相对 20 °C 等比伸缩，缩放中心取零件坐标系原点。
 * 光栅尺按厂家给定温度系数自行补偿，这里只补零件。
 */

export const REFERENCE_TEMP_C = 20

export const MATERIALS = {
  steel: { label: "碳钢", alpha: 11.5e-6 },
  stainless: { label: "不锈钢", alpha: 16e-6 },
  castIron: { label: "铸铁", alpha: 10.5e-6 },
  aluminum: { label: "铝合金", alpha: 23e-6 },
} as const

export type MaterialKey = keyof typeof MATERIALS

export type ThermalSettings = {
  enabled: boolean
  material: MaterialKey
  /** 零件温度传感器读数（°C）。 */
  partTempC: number
}

export type ThermalApplied = {
  enabled: boolean
  material: MaterialKey
  partTempC: number
  alpha: number
  /** 20 °C 下尺寸 × scale = 当前温度下尺寸。 */
  scale: number
}

export const DEFAULT_THERMAL: ThermalSettings = { enabled: true, material: "steel", partTempC: REFERENCE_TEMP_C }

export function thermalScale(alpha: number, tempC: number): number {
  return 1 + alpha * (tempC - REFERENCE_TEMP_C)
}

export function appliedThermal(settings: ThermalSettings): ThermalApplied {
  const alpha = MATERIALS[settings.material].alpha
  return {
    ...settings,
    alpha,
    scale: settings.enabled ? thermalScale(alpha, settings.partTempC) : 1,
  }
}
