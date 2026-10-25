"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { MODEL_ACCEPT } from "@/lib/model/load"
import { FACE_KIND_LABEL, analyzeFace } from "@/lib/model/recognize"
import { useCmmStore, type PickMode } from "@/lib/store"
import { Box, Check, FileUp, MousePointerClick, Route, RotateCw, X } from "lucide-react"
import { useMemo, useRef } from "react"

const MODES: { value: PickMode; label: string; hint: string }[] = [
  {
    value: "face",
    label: "点面",
    hint: "点一个面：平面自动撒点，孔/轴按圆周均布，球取极点+纬线",
  },
  {
    value: "line",
    label: "直线",
    hint: "点一个侧面，沿长边生成 3 点直线（找正用的第二基准）",
  },
  { value: "point", label: "单点", hint: "在点击处生成一个沿法向触测的点" },
  {
    value: "circle",
    label: "手动圆",
    hint: "在孔壁/轴上逐点点击，至少 3 点后点「完成」",
  },
  {
    value: "plane",
    label: "手动面",
    hint: "在平面上逐点点击，至少 3 点后点「完成」",
  },
  { value: "off", label: "浏览", hint: "只旋转视角，不拾取" },
]

function faceSummary(info: ReturnType<typeof analyzeFace>): string {
  if (info.kind === "cylinder")
    return `${info.inner ? "孔" : "轴"} Ø${(info.radius! * 2).toFixed(3)} · 深 ${((info.axialMax ?? 0) - (info.axialMin ?? 0)).toFixed(1)}`
  if (info.kind === "sphere") return `球 Ø${(info.radius! * 2).toFixed(3)}`
  if (info.kind === "plane") {
    const n = info.normal!
    return `平面 ${info.area.toFixed(0)} mm² · 法向 (${n.x.toFixed(2)}, ${n.y.toFixed(2)}, ${n.z.toFixed(2)})`
  }
  return FACE_KIND_LABEL[info.kind]
}

function formatSeconds(s: number): string {
  const m = Math.floor(s / 60)
  return m ? `${m} 分 ${Math.round(s % 60)} 秒` : `${Math.round(s)} 秒`
}

export function ModelToolbar() {
  const model = useCmmStore((s) => s.model)
  const modelBusy = useCmmStore((s) => s.modelBusy)
  const pickMode = useCmmStore((s) => s.pickMode)
  const setPickMode = useCmmStore((s) => s.setPickMode)
  const hoverFace = useCmmStore((s) => s.hoverFace)
  const manual = useCmmStore((s) => s.manualPoints)
  const finishManual = useCmmStore((s) => s.finishManualPick)
  const cancelManual = useCmmStore((s) => s.cancelManualPick)
  const plan = useCmmStore((s) => s.plan)
  const planBusy = useCmmStore((s) => s.planBusy)
  const planPath = useCmmStore((s) => s.planPath)
  const steps = useCmmStore((s) => s.program.steps)
  const orientation = useCmmStore((s) => s.modelOrientation)
  const setOrientation = useCmmStore((s) => s.setModelOrientation)
  const importModel = useCmmStore((s) => s.importModel)
  const loadSample = useCmmStore((s) => s.loadSampleModel)
  const clearModel = useCmmStore((s) => s.clearModel)
  const running = useCmmStore((s) => s.running)
  const fileRef = useRef<HTMLInputElement>(null)

  const hoverInfo = useMemo(() => (model && hoverFace !== null ? analyzeFace(model, hoverFace) : null), [model, hoverFace])
  const issueNames = plan?.issues.map((i) => steps.find((s) => s.id === i.stepId)?.name ?? i.stepId) ?? []
  const activeHint = MODES.find((m) => m.value === pickMode)?.hint

  const fileInput = (
    <input
      ref={fileRef}
      type="file"
      accept={MODEL_ACCEPT}
      className="hidden"
      onChange={(e) => {
        const file = e.target.files?.[0]
        e.target.value = ""
        if (file) void importModel(file)
      }}
    />
  )

  if (!model) {
    return (
      <div className="pointer-events-auto absolute top-2 left-2 flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-1.5 rounded-lg border bg-card/90 px-2 py-1.5 text-xs shadow-sm backdrop-blur">
        <Box className="size-3.5 text-muted-foreground" />
        <span className="text-muted-foreground">导入零件模型后，可在模型上点选测点并自动生成轨迹</span>
        <Button size="xs" onClick={() => fileRef.current?.click()} disabled={modelBusy || running}>
          <FileUp data-icon="inline-start" />
          {modelBusy ? "解析中…" : "导入 STEP / STL"}
        </Button>
        <Button size="xs" variant="outline" onClick={() => void loadSample()} disabled={modelBusy || running}>
          示例零件
        </Button>
        {fileInput}
      </div>
    )
  }

  return (
    <div className="pointer-events-none absolute inset-x-2 top-2 flex flex-col gap-1.5">
      <div className="pointer-events-auto flex flex-wrap items-center gap-1 self-start rounded-lg border bg-card/90 px-2 py-1.5 text-xs shadow-sm backdrop-blur">
        <MousePointerClick className="size-3.5 text-muted-foreground" />
        {MODES.map((m) => (
          <Button
            key={m.value}
            size="xs"
            variant={pickMode === m.value ? "default" : "outline"}
            title={m.hint}
            disabled={running}
            onClick={() => setPickMode(m.value)}
          >
            {m.label}
          </Button>
        ))}
        {(pickMode === "circle" || pickMode === "plane") && (
          <>
            <Badge variant="secondary">{manual.length} 点</Badge>
            <Button size="xs" onClick={finishManual} disabled={manual.length < 3}>
              <Check data-icon="inline-start" />
              完成
            </Button>
            <Button size="xs" variant="ghost" onClick={cancelManual} disabled={!manual.length}>
              <X data-icon="inline-start" />
              清除
            </Button>
          </>
        )}
      </div>

      <div className="pointer-events-auto flex flex-wrap items-center gap-1 self-start rounded-lg border bg-card/90 px-2 py-1.5 text-xs shadow-sm backdrop-blur">
        <span className="max-w-48 truncate font-medium" title={model.name}>
          {model.name}
        </span>
        <Badge variant="outline">
          {model.faceSource === "brep" ? `${model.faceCount} 个 B-rep 面` : `${model.faceCount} 个分区`}
        </Badge>
        <span className="text-muted-foreground">装夹朝向</span>
        {(["rx", "ry", "rz"] as const).map((axis) => (
          <Button
            key={axis}
            size="xs"
            variant="outline"
            disabled={running}
            title={`绕 ${axis.slice(1).toUpperCase()} 轴转 90°`}
            onClick={() =>
              setOrientation({
                ...orientation,
                [axis]: (orientation[axis] + 90) % 360,
              })
            }
          >
            <RotateCw data-icon="inline-start" />
            {axis.slice(1).toUpperCase()} {orientation[axis]}°
          </Button>
        ))}
        <Button size="xs" variant="outline" onClick={() => fileRef.current?.click()} disabled={modelBusy || running}>
          <FileUp data-icon="inline-start" />
          换模型
        </Button>
        <Button size="xs" variant="ghost" onClick={clearModel} disabled={running}>
          移除
        </Button>
        {fileInput}
      </div>

      <div className="pointer-events-auto self-start rounded-lg border bg-card/90 px-2 py-1.5 text-xs shadow-sm backdrop-blur">
        {hoverInfo ? (
          <p>
            <span className="text-sky-500">●</span> {faceSummary(hoverInfo)}
          </p>
        ) : (
          <p className="text-muted-foreground">{activeHint}</p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <Route className="size-3.5 text-muted-foreground" />
          {plan ? (
            <>
              <span>
                自动轨迹 {plan.moves.length} 段 · {(plan.lengthMm / 1000).toFixed(2)} m · 约 {formatSeconds(plan.seconds)}
              </span>
              {plan.issues.length ? (
                <Badge variant="destructive" title={plan.issues.map((i) => i.message).join("\n")}>
                  {plan.issues.length} 个特征到不了：{issueNames.join("、")}
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-teal-700 dark:text-teal-300">
                  无干涉
                </Badge>
              )}
            </>
          ) : (
            <span className="text-muted-foreground">点选特征后自动规划轨迹</span>
          )}
          <Button size="xs" variant="ghost" onClick={() => void planPath()} disabled={planBusy || running || !steps.length}>
            {planBusy ? "规划中…" : "重新规划"}
          </Button>
        </div>
        <p className="mt-0.5 flex gap-2 text-[10px] text-muted-foreground">
          <span>
            <span className="text-slate-400">━</span> 快移
          </span>
          <span>
            <span className="text-emerald-400">━</span> 测量进给
          </span>
          <span>
            <span className="text-rose-400">━</span> 触测
          </span>
          <span>
            <span className="text-amber-300">●</span> 测点 / 方向
          </span>
        </p>
      </div>
    </div>
  )
}
