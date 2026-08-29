"use client"

import { PILOT_CASES } from "@/lib/capp/cases"
import { generatePlan } from "@/lib/capp/generate"
import { DEFAULT_RULES } from "@/lib/capp/rules"
import type { DecisionRule, GeneratedPlan, ReviewRecord, ReviewStatus } from "@/lib/capp/types"
import { create } from "zustand"

const RULE_KEY = "jiujiu-capp-rules-v1"
const REVIEW_KEY = "jiujiu-capp-reviews-v1"

function loadRules(): DecisionRule[] {
  if (typeof window === "undefined") return DEFAULT_RULES
  try {
    const raw = localStorage.getItem(RULE_KEY)
    if (!raw) return DEFAULT_RULES
    const parsed = JSON.parse(raw) as DecisionRule[]
    return parsed.length ? parsed : DEFAULT_RULES
  } catch {
    return DEFAULT_RULES
  }
}

function loadReviews(): ReviewRecord[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(REVIEW_KEY)
    return raw ? (JSON.parse(raw) as ReviewRecord[]) : []
  } catch {
    return []
  }
}

type CappState = {
  rules: DecisionRule[]
  reviews: ReviewRecord[]
  selectedId: string
  generated: GeneratedPlan | null
  hydrate: () => void
  selectCase: (id: string) => void
  toggleRule: (id: string) => void
  updateRuleLogic: (id: string, logic: string) => void
  generate: () => void
  review: (status: ReviewStatus, comment: string) => void
}

export const useCappStore = create<CappState>((set, get) => ({
  rules: DEFAULT_RULES,
  reviews: [],
  selectedId: PILOT_CASES[0].id,
  generated: null,

  hydrate: () => {
    const rules = loadRules()
    const reviews = loadReviews()
    set({ rules, reviews })
  },

  selectCase: (id) => set({ selectedId: id, generated: null }),

  toggleRule: (id) => {
    const rules = get().rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r))
    localStorage.setItem(RULE_KEY, JSON.stringify(rules))
    set({ rules })
  },

  updateRuleLogic: (id, logic) => {
    const rules = get().rules.map((r) => (r.id === id ? { ...r, logic } : r))
    localStorage.setItem(RULE_KEY, JSON.stringify(rules))
    set({ rules })
  },

  generate: () => {
    const part = PILOT_CASES.find((c) => c.id === get().selectedId)
    if (!part) return
    set({ generated: generatePlan(part, get().rules) })
  },

  review: (status, comment) => {
    const record: ReviewRecord = {
      caseId: get().selectedId,
      status,
      comment,
      at: new Date().toISOString(),
    }
    const reviews = [record, ...get().reviews.filter((r) => r.caseId !== record.caseId)]
    localStorage.setItem(REVIEW_KEY, JSON.stringify(reviews))
    set({ reviews })
  },
}))
