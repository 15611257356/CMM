"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { formatMm } from "@/lib/geom"
import { GDT_LABEL } from "@/lib/program/demo"
import { useCmmStore } from "@/lib/store"
import { Circle, Plus, RotateCcw, Square, Trash2 } from "lucide-react"

const KIND_LABEL = { point: "点", plane: "平面", circle: "圆" } as const

export function ProgramPanel() {
  const program = useCmmStore((s) => s.program)
  const selected = useCmmStore((s) => s.selectedStepId)
  const current = useCmmStore((s) => s.currentStepId)
  const running = useCmmStore((s) => s.running)
  const results = useCmmStore((s) => s.results)
  const gdt = useCmmStore((s) => s.gdtResults)
  const setSelected = useCmmStore((s) => s.setSelectedStep)
  const addStep = useCmmStore((s) => s.addStep)
  const removeStep = useCmmStore((s) => s.removeStep)
  const resetDemo = useCmmStore((s) => s.resetDemoProgram)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div>
          <p className="text-[11px] tracking-wide text-muted-foreground uppercase">测量程序</p>
          <h2 className="text-sm font-semibold">{program.name}</h2>
        </div>
        <Button size="xs" variant="outline" onClick={resetDemo} disabled={running}>
          <RotateCcw data-icon="inline-start" />
          示例
        </Button>
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
              const done = results.some((r) => r.stepId === step.id)
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
                        <span className="flex items-center gap-1.5">
                          <span className="truncate font-medium">{step.name}</span>
                          <Badge variant="outline">{KIND_LABEL[step.kind]}</Badge>
                          {current === step.id ? <Badge>测量中</Badge> : null}
                          {done ? (
                            <Badge variant="secondary" className="text-teal-700 dark:text-teal-300">
                              完成
                            </Badge>
                          ) : null}
                        </span>
                        <span className="text-xs text-muted-foreground">{step.points.length} 个触测点</span>
                      </span>
                    </button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      disabled={running}
                      onClick={() => removeStep(step.id)}
                    >
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
        <p className="mb-1.5 text-[11px] text-muted-foreground">添加特征</p>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" disabled={running} onClick={() => addStep("point")}>
            <Plus data-icon="inline-start" />
            点
          </Button>
          <Button size="sm" variant="outline" disabled={running} onClick={() => addStep("plane")}>
            <Square data-icon="inline-start" />
            平面
          </Button>
          <Button size="sm" variant="outline" disabled={running} onClick={() => addStep("circle")}>
            <Circle data-icon="inline-start" />
            圆
          </Button>
        </div>
      </div>

      <div className="border-t px-3 py-2">
        <p className="mb-1.5 text-[11px] text-muted-foreground">形位公差</p>
        {program.gdt.length === 0 ? (
          <p className="text-xs text-muted-foreground">添加平面或圆后会自动带上公差检查。</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {program.gdt.map((check) => {
              const result = gdt.find((g) => g.checkId === check.id)
              return (
                <li key={check.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">
                    {GDT_LABEL[check.type]} · {check.name.replace(GDT_LABEL[check.type], "").trim() || check.name}
                  </span>
                  <span className="shrink-0 font-mono text-muted-foreground">
                    {result ? (
                      <span className={result.passed ? "text-teal-600 dark:text-teal-400" : "text-destructive"}>
                        {formatMm(result.value, 4)}
                        {result.passed ? "" : " 超差"}
                      </span>
                    ) : (
                      `≤ ${formatMm(check.tolerance, 3)}`
                    )}
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
