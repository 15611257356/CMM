"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { workOffsetFromPose, workOffsetNc } from "@/lib/coords/work-offset"
import { PLATE } from "@/lib/machine/setup"
import { applyPoint, compose, fromPoseDeg, type RigidTransform } from "@/lib/math/transform"
import { applyDialYaw } from "@/lib/program/indicator"
import { checkTravel, SAMPLE_NC, transformNcProgram, type ToolpathPoint } from "@/lib/nc/transform"
import { useCmmStore, type NcMode } from "@/lib/store"
import { Download, FileUp } from "lucide-react"
import { useMemo, useRef, useState } from "react"

function PathPreview({
  original,
  next,
  delta,
}: {
  original: ToolpathPoint[]
  next: ToolpathPoint[]
  delta: RigidTransform
}) {
  const all = [...original, ...next]
  const xs = all.map((p) => p.x).concat([0, PLATE.w])
  const ys = all.map((p) => p.y).concat([0, PLATE.d])
  const minX = Math.min(...xs) - 10
  const maxX = Math.max(...xs) + 10
  const minY = Math.min(...ys) - 10
  const maxY = Math.max(...ys) + 10
  const toPts = (path: ToolpathPoint[]) => path.map((p) => `${p.x},${maxY + minY - p.y}`).join(" ")
  const corners = [
    { x: 0, y: 0 },
    { x: PLATE.w, y: 0 },
    { x: PLATE.w, y: PLATE.d },
    { x: 0, y: PLATE.d },
  ]
  const actual = corners.map((c) => applyPoint(delta, { ...c, z: 0 }))
  const outline = (pts: { x: number; y: number }[]) => pts.map((p) => `${p.x},${maxY + minY - p.y}`).join(" ")
  return (
    <svg viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`} className="h-64 w-full rounded-md bg-[#12151b]">
      <polygon points={outline(corners)} fill="none" stroke="#64748b" strokeDasharray="3 3" strokeWidth={0.6} />
      <polygon points={outline(actual)} fill="#94a3b822" stroke="#cbd5e1" strokeWidth={0.8} />
      <polyline points={toPts(original)} fill="none" stroke="#64748b" strokeWidth={0.6} />
      <polyline points={toPts(next)} fill="none" stroke="#22d3ee" strokeWidth={0.9} />
    </svg>
  )
}

export function NcPanel() {
  const evaluation = useCmmStore((s) => s.evaluation)
  const machineTool = useCmmStore((s) => s.machineTool)
  const stored = useCmmStore((s) => s.ncSource)
  const setNcSource = useCmmStore((s) => s.setNcSource)
  const mode = useCmmStore((s) => s.ncMode)
  const setMode = useCmmStore((s) => s.setNcMode)
  const withRotation = useCmmStore((s) => s.withRotation)
  const dialResult = useCmmStore((s) => s.dialResult)
  const useDialYaw = useCmmStore((s) => s.useDialYaw)
  const log = useCmmStore((s) => s.log)
  const [confirmedFor, setConfirmedFor] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const source = stored ?? SAMPLE_NC

  const delta = useMemo(() => {
    if (!evaluation) return null
    const base = evaluation.pallet.deltaInNominalPart
    if (!useDialYaw || !dialResult) return base
    return compose(base, fromPoseDeg({ x: 0, y: 0, z: 0, rz: dialResult.angleDeg, ry: 0, rx: 0 }))
  }, [evaluation, useDialYaw, dialResult])

  const result = useMemo(() => (delta ? transformNcProgram(source, delta) : null), [delta, source])

  if (!evaluation || !result) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-sm font-medium">还没有装夹偏差</p>
        <p className="max-w-md text-xs text-muted-foreground">
          先运行预检程序，测出零件相对零点托盘的实际位置。之后这里可以输出工件坐标系偏置，或者直接改写加工程序。
        </p>
      </div>
    )
  }

  const nominalOffset = workOffsetFromPose(evaluation.pallet.nominal, machineTool)
  const actualOffset = workOffsetFromPose(
    applyDialYaw(evaluation.pallet.actual, dialResult, useDialYaw),
    machineTool
  )
  const travelIssues = checkTravel(result.bounds, nominalOffset, machineTool.travel)
  const output =
    mode === "offset"
      ? `${workOffsetNc(actualOffset, withRotation)}\n(以下为原程序，未改动)\n${source}`
      : `${workOffsetNc(nominalOffset, false)}\n(预检机改写：按实测装夹重算坐标，${result.changedLines} 行)\n${result.output}`
  const blocking = Boolean(evaluation.pallet.tiltWarning) || travelIssues.length > 0
  const confirmed = confirmedFor === output

  const download = () => {
    const blob = new Blob([output], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = mode === "offset" ? "预检_工件坐标系.nc" : "预检_改写程序.nc"
    a.click()
    URL.revokeObjectURL(url)
    log("info", `已导出${mode === "offset" ? "工件坐标系偏置 + 原程序" : "改写后的加工程序"}`)
  }

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ["offset", "只输出坐标系偏置（推荐）"],
              ["rewrite", "改写整个加工程序"],
            ] as [NcMode, string][]
          ).map(([value, label]) => (
            <Button key={value} size="sm" variant={mode === value ? "default" : "outline"} onClick={() => setMode(value)}>
              {label}
            </Button>
          ))}
          <input
            ref={fileRef}
            type="file"
            accept=".nc,.txt,.tap,.cnc,.mpf"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0]
              if (file) {
                setNcSource(await file.text())
                log("info", `已载入加工程序 ${file.name}`)
              }
              e.target.value = ""
            }}
          />
          <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
            <FileUp data-icon="inline-start" />
            载入程序
          </Button>
          <Badge variant="outline">FANUC 风格 · G17 · 公制</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {mode === "offset"
            ? "原程序不动，只把实测的工件坐标系（和 G68 旋转）写进机床。风险最小。"
            : `机床工件坐标系固定为理论值 ${nominalOffset.register}，把程序里每个运动点按实测装夹旋转平移。进给、转速、刀补号不改。`}
        </p>

        <div className="grid gap-3 lg:grid-cols-2">
          <div className="flex flex-col gap-1">
            <p className="text-[11px] text-muted-foreground">原加工程序（可直接编辑）</p>
            <textarea
              value={source}
              onChange={(e) => setNcSource(e.target.value)}
              spellCheck={false}
              className="h-72 w-full resize-y rounded-md border bg-transparent p-2 font-mono text-xs leading-relaxed"
            />
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-[11px] text-muted-foreground">输出</p>
            <textarea
              readOnly
              value={output}
              spellCheck={false}
              className="h-72 w-full resize-y rounded-md border bg-muted/40 p-2 font-mono text-xs leading-relaxed"
            />
          </div>
        </div>

        <div>
          <p className="mb-1 text-[11px] text-muted-foreground">
            刀路预览（零件理论坐标）：灰色虚线 = 理论位置，白色 = 实测零件，灰线 = 原刀路，青色 = 按实测位置的刀路
          </p>
          <PathPreview original={result.originalPath} next={result.newPath} delta={evaluation.pallet.deltaInNominalPart} />
        </div>

        {evaluation.pallet.tiltWarning || travelIssues.length || result.warnings.length ? (
          <ul className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
            {evaluation.pallet.tiltWarning ? <li className="text-destructive">{evaluation.pallet.tiltWarning}</li> : null}
            {travelIssues.map((m) => (
              <li key={m} className="text-destructive">
                超行程：{m}
              </li>
            ))}
            {result.warnings.map((w) => (
              <li key={`${w.line}-${w.message}`} className="text-amber-600 dark:text-amber-400">
                第 {w.line} 行：{w.message}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-teal-600 dark:text-teal-400">未发现超行程、倾斜或不支持的指令。</p>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t pt-3">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={blocking}
              onChange={(e) => setConfirmedFor(e.target.checked ? output : null)}
            />
            我已核对刀路预览和告警，确认可以下发
          </label>
          <Button size="sm" disabled={!confirmed || blocking} onClick={download}>
            <Download data-icon="inline-start" />
            导出
          </Button>
          {blocking ? <span className="text-xs text-destructive">存在超行程或倾斜，禁止导出</span> : null}
        </div>
      </div>
    </ScrollArea>
  )
}
