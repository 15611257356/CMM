import type { BlankType, DecisionRule, FixtureMode, GeneratedPlan, PilotCase, ProcessStep } from "@/lib/capp/types"

export function generatePlan(part: PilotCase, rules: DecisionRule[]): GeneratedPlan {
  const on = (id: string) => rules.find((r) => r.id === id)?.enabled !== false

  let blank: BlankType = "板材"
  let blankReason = "外形接近板件，默认板材下料。"
  if (on("blank-thickness") && part.thicknessMm > 30) {
    blank = "块料"
    blankReason = `厚度 ${part.thicknessMm} mm，超过 30 mm，按规则改用块料。`
  } else if (on("blank-thickness")) {
    blankReason = `厚度 ${part.thicknessMm} mm ≤ 30 mm，且外形规矩，用板材。`
  }

  let fixture: FixtureMode = "通用装夹"
  let fixtureReason = "小批量规矩件，平口钳即可。"
  if (on("fix-batch") && (part.lotSize >= 50 || part.irregular)) {
    fixture = "专用夹具"
    fixtureReason = part.irregular
      ? "外形不规则，通用钳口定位不稳，改用靠形/专用夹具。"
      : `批量 ${part.lotSize} 件 ≥ 50，做专用钻模或铣槽胎具。`
  } else if (on("fix-general")) {
    fixtureReason = `批量 ${part.lotSize} 件，外形规矩，通用装夹。`
  }

  const steps: ProcessStep[] = [{ seq: 1, name: "下料", content: `${blank}下料，单边留加工余量`, machine: "锯床" }]

  if (on("seq-datum") && part.datumUncut) {
    steps.push({
      seq: steps.length + 1,
      name: "铣基准",
      content: "先铣大面及相邻侧面，作为后续定位基准",
      machine: "立铣",
    })
  }

  const hasOutline = part.features.some((f) => /外形|四周|台阶|型腔|斜面|弧形/.test(f))
  if (hasOutline) {
    steps.push({
      seq: steps.length + 1,
      name: "铣外形/台阶",
      content: part.features.filter((f) => /外形|四周|台阶|型腔|斜面|弧形/.test(f)).join("，"),
      machine: "立铣",
    })
  }

  if (on("seq-hole") && part.hasPrecisionHole) {
    steps.push({
      seq: steps.length + 1,
      name: "钻铰孔",
      content: "配合孔按钻→铰（必要时扩）加工，保证公差带",
      machine: "钻床",
    })
  } else if (part.features.some((f) => /孔|螺纹|攻/.test(f))) {
    steps.push({
      seq: steps.length + 1,
      name: "钻孔攻丝",
      content: "钻通孔或攻螺纹，去毛刺",
      machine: "钻床",
    })
  }

  const hasSlot = part.features.some((f) => /槽|开口|腰/.test(f))
  if (hasSlot) {
    const afterHole = on("seq-slot-after-hole") && part.hasPrecisionHole
    const slotStep: ProcessStep = {
      seq: steps.length + 1,
      name: "铣槽/开口",
      content: afterHole ? "孔完成后铣腰槽或开口，避免开口后刚性不足" : "铣腰槽或开口",
      machine: "立铣",
    }
    if (afterHole) {
      steps.push(slotStep)
    } else {
      const holeIndex = steps.findIndex((s) => s.name.includes("孔") || s.name.includes("攻"))
      if (holeIndex === -1) steps.push(slotStep)
      else steps.splice(holeIndex, 0, { ...slotStep, seq: holeIndex + 1 })
    }
  }

  const normalized = steps.map((s, i) => ({ ...s, seq: i + 1 }))
  return { caseId: part.id, blank, blankReason, fixture, fixtureReason, steps: normalized }
}

export function compareWithActual(part: PilotCase, plan: GeneratedPlan) {
  const blankMatch = plan.blank === part.actualBlank
  const fixtureMatch = plan.fixture === part.actualFixture
  const actualNames = part.actualRoute.map((s) => s.name)
  const genNames = plan.steps.map((s) => s.name)
  const missing = actualNames.filter((n) => !genNames.some((g) => g.includes(n.slice(0, 2)) || n.includes(g.slice(0, 2))))
  return { blankMatch, fixtureMatch, missing }
}
