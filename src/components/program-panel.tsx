"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { formatMm } from "@/lib/geom"
import { GDT_LABEL, KIND_LABEL } from "@/lib/program/demo"
import type { AlignmentDef, ProgramStep } from "@/lib/program/types"
import { useCmmStore } from "@/lib/store"
import { Circle, FileDown, Minus, Plus, Square, Trash2 } from "lucide-react"

const ROLE_LABEL = { primary: "第一基准面", secondary: "第二基准线", origin: "原点" } as const

export function ProgramPanel() {
  const program = useCmmStore((s) => s.program)
  const selected = useCmmStore((s) => s.selectedStepId)
  const current = useCmmStore((s) => s.currentStepId)
  const running = useCmmStore((s) => s.running)
  const evaluation = useCmmStore((s) => s.evaluation)
  const hits = useCmmStore((s) => s.hits)
  const setSelected = useCmmStore((s) => s.setSelectedStep)
  const addStep = useCmmStore((s) => s.addStep)
  const removeStep = useCmmStore((s) => s.removeStep)
  const loadTemplate = useCmmStore((s) => s.loadTemplate)
  const setAlignment = useCmmStore((s) => s.setAlignment)
  const setTolerance = useCmmStore((s) => s.setTolerance)
  const inspectMode = useCmmStore((s) => s.inspectMode)
  const exportDmis = useCmmStore((s) => s.exportProgramDmis)

  const roleOf = (id: string) => {
    const a = program.alignment
    if (!a) return null
    return (Object.keys(ROLE_LABEL) as (keyof typeof ROLE_LABEL)[]).find((k) => a[k] === id) ?? null
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="min-w-0">
          <p className="text-[11px] tracking-wide text-muted-foreground">自动编程（零件坐标）</p>
          <h2 className="truncate text-sm font-semibold">{program.name}</h2>
        </div>
        <div className="flex gap-1">
          <Button
            size="xs"
            variant={inspectMode === "preset" ? "secondary" : "outline"}
            onClick={() => loadTemplate("preset")}
            disabled={running}
            title="按布点规则自动生成预调程序"
          >
            预调
          </Button>
          <Button
            size="xs"
            variant={inspectMode === "post" ? "secondary" : "outline"}
            onClick={() => loadTemplate("post")}
            disabled={running}
            title="按布点规则自动生成复测程序"
          >
            复测
          </Button>
        </div>
      </div>

      {program.steps.length === 0 ? (
        <div className="mx-3 rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
          还没有测量步骤。加载示例程序，或从下方添加特征。
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1 px-2">
          <ol className="space-y-1 pb-2">
            {program.steps.map((step, index) => {
              const active = selected === step.id || current === step.id
              const result = evaluation?.features.find((f) => f.stepId === step.id)
              const touched = hits.find((h) => h.stepId === step.id)?.hits.length ?? 0
              const role = roleOf(step.id)
              return (
                <li key={step.id}>
                  <div
                    className={`flex w-full items-start gap-2 rounded-lg px-2 py-2 text-sm transition-colors ${
                      active ? "bg-sidebar-accent text-foreground" : "hover:bg-muted/60"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelected(step.id)}
                      className="flex min-w-0 flex-1 items-start gap-2 text-left"
                    >
                      <span className="mt-0.5 w-5 shrink-0 font-mono text-xs text-muted-foreground">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1">
                          <span className="truncate font-medium">{step.name}</span>
                          <Badge variant="outline">{KIND_LABEL[step.kind]}</Badge>
                          {role ? <Badge variant="secondary">{ROLE_LABEL[role]}</Badge> : null}
                          {current === step.id ? <Badge>测量中</Badge> : null}
                          {result ? (
                            result.ok ? (
                              <Badge variant="secondary" className="text-teal-700 dark:text-teal-300">
                                完成
                              </Badge>
                            ) : (
                              <Badge variant="destructive">失败</Badge>
                            )
                          ) : null}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {running && touched ? `${touched}/` : ""}
                          {step.points.length} 个触测点
                          {result?.diameter !== undefined ? ` · Ø${result.diameter.toFixed(4)}` : ""}
                          {result?.error ? ` · ${result.error}` : ""}
                        </span>
                      </span>
                    </button>
                    <Button size="icon-xs" variant="ghost" disabled={running} onClick={() => removeStep(step.id)}>
                      <Trash2 />
                    </Button>
                  </div>
                </li>
              )
            })}
          </ol>
        </ScrollArea>
      )}

      <div className="border-t px-3 py-2">
        <p className="mb-1.5 text-[11px] text-muted-foreground">在测针当前位置添加特征</p>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" disabled={running} onClick={() => addStep("point")}>
            <Plus data-icon="inline-start" />
            点
          </Button>
          <Button size="sm" variant="outline" disabled={running} onClick={() => addStep("line")}>
            <Minus data-icon="inline-start" />
            边
          </Button>
          <Button size="sm" variant="outline" disabled={running} onClick={() => addStep("plane")}>
            <Square data-icon="inline-start" />
            平面
          </Button>
          <Button size="sm" variant="outline" disabled={running} onClick={() => addStep("circle")}>
            <Circle data-icon="inline-start" />
            孔
          </Button>
          <Button size="sm" variant="ghost" disabled={program.steps.length === 0} onClick={exportDmis}>
            <FileDown data-icon="inline-start" />
            导出 DMIS
          </Button>
        </div>
      </div>

      <StepEditor running={running} />

      <AlignmentEditor running={running} setAlignment={setAlignment} />

      <div className="border-t px-3 py-2">
        <p className="mb-1.5 text-[11px] text-muted-foreground">形位公差（最小二乘评价，点公差可改）</p>
        {program.gdt.length === 0 ? (
          <p className="text-xs text-muted-foreground">添加平面、边或孔后会自动带上公差检查。</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {program.gdt.map((check) => {
              const result = evaluation?.gdt.find((g) => g.checkId === check.id)
              return (
                <li key={check.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">
                    {GDT_LABEL[check.type]} · {check.name.replace(GDT_LABEL[check.type], "").trim() || check.name}
                  </span>
                  <span className="flex shrink-0 items-center gap-1 font-mono text-muted-foreground">
                    {result ? (
                      <span className={result.passed ? "text-teal-600 dark:text-teal-400" : "text-destructive"}>
                        {formatMm(result.value, 4)}
                        {result.passed ? "" : " 超差"}
                      </span>
                    ) : null}
                    <Input
                      aria-label={`${check.name}公差`}
                      type="number"
                      step="0.001"
                      min="0.001"
                      disabled={running}
                      defaultValue={check.tolerance}
                      key={`${check.id}-${check.tolerance}`}
                      onBlur={(e) => setTolerance(check.id, Number(e.target.value))}
                      className="h-6 w-16 px-1 text-right font-mono text-xs"
                    />
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

function StepEditor({ running }: { running: boolean }) {
  const program = useCmmStore((s) => s.program)
  const selected = useCmmStore((s) => s.selectedStepId)
  const rename = useCmmStore((s) => s.renameSelectedStep)
  const setCount = useCmmStore((s) => s.setStepPointCount)
  const setCircle = useCmmStore((s) => s.setStepCircle)
  const step = program.steps.find((item) => item.id === selected)
  if (!step) return null
  return (
    <div className="space-y-2 border-t px-3 py-2">
      <p className="text-[11px] text-muted-foreground">编辑「{step.name}」</p>
      <Input
        aria-label="特征名称"
        defaultValue={step.name}
        key={`${step.id}-name-${step.name}`}
        disabled={running}
        onBlur={(e) => rename(e.target.value)}
        className="h-7 text-xs"
      />
      {step.kind !== "point" ? (
        <label className="flex items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground">触测点数</span>
          <Input
            aria-label="触测点数"
            type="number"
            min={step.kind === "line" ? 2 : 3}
            max={step.kind === "circle" ? 12 : 9}
            defaultValue={step.points.length}
            key={`${step.id}-n-${step.points.length}`}
            disabled={running}
            onBlur={(e) => setCount(step.id, Number(e.target.value))}
            className="h-7 w-16 text-right font-mono text-xs"
          />
        </label>
      ) : null}
      {step.kind === "circle" && step.nominalRadius !== undefined ? (
        <div className="grid grid-cols-2 gap-2">
          <Field
            label="名义直径"
            value={step.nominalRadius * 2}
            disabled={running}
            onCommit={(diameter) => setCircle(step.id, { diameter })}
          />
          <Field
            label="直径公差 ±"
            value={step.sizeTolerance ?? 0.03}
            disabled={running}
            onCommit={(sizeTolerance) => setCircle(step.id, { sizeTolerance })}
          />
        </div>
      ) : null}
    </div>
  )
}

function Field({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string
  value: number
  disabled: boolean
  onCommit: (value: number) => void
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <Input
        aria-label={label}
        type="number"
        step="0.001"
        defaultValue={value}
        key={`${label}-${value}`}
        disabled={disabled}
        onBlur={(e) => {
          const next = Number(e.target.value)
          if (Number.isFinite(next)) onCommit(next)
        }}
        className="h-7 font-mono text-xs"
      />
    </label>
  )
}

function AlignmentEditor({
  running,
  setAlignment,
}: {
  running: boolean
  setAlignment: (role: keyof AlignmentDef, stepId: string | null) => void
}) {
  const steps = useCmmStore((s) => s.program.steps)
  const alignment = useCmmStore((s) => s.program.alignment)
  const picks: { role: keyof AlignmentDef; label: string; kind: ProgramStep["kind"] }[] = [
    { role: "primary", label: "第一基准面", kind: "plane" },
    { role: "secondary", label: "第二基准边", kind: "line" },
    { role: "origin", label: "原点", kind: "point" },
  ]
  return (
    <div className="space-y-1.5 border-t px-3 py-2">
      <p className="text-[11px] text-muted-foreground">3-2-1 找正基准</p>
      {picks.map((pick) => {
        const options = steps.filter((step) => step.kind === pick.kind)
        return (
          <label key={pick.role} className="flex items-center gap-2 text-xs">
            <Label className="w-16 shrink-0 text-[11px] text-muted-foreground">{pick.label}</Label>
            <select
              aria-label={pick.label}
              disabled={running || options.length === 0}
              value={alignment?.[pick.role] ?? ""}
              onChange={(e) => setAlignment(pick.role, e.target.value || null)}
              className="h-7 min-w-0 flex-1 rounded-lg border border-input bg-transparent px-2 text-xs dark:bg-input/30"
            >
              <option value="">不使用</option>
              {options.map((step) => (
                <option key={step.id} value={step.id}>
                  {step.name}
                </option>
              ))}
            </select>
          </label>
        )
      })}
    </div>
  )
}
