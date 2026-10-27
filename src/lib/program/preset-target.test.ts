import { describe, expect, it } from "vitest"
import { presetTarget } from "@/lib/program/preset-target"

describe("presetTarget", () => {
  it("runs the faces the user picked on the model", () => {
    expect(presetTarget({ hasModel: true, modelName: "lb02.step", stepCount: 2 })).toBe("picked")
  })

  it("asks for picks when a model is loaded and the program is empty", () => {
    expect(presetTarget({ hasModel: true, modelName: "lb02.step", stepCount: 0 })).toBe("need-picks")
  })

  it("builds the plate program when no model is loaded", () => {
    expect(presetTarget({ hasModel: false, stepCount: 8 })).toBe("plate")
    expect(presetTarget({ hasModel: false, modelName: undefined, stepCount: 0 })).toBe("plate")
  })

  it("keeps an explicit plate program even if a model is on screen", () => {
    expect(presetTarget({ hasModel: true, stepCount: 4 })).toBe("plate")
  })
})
