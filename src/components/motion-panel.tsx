"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { formatMm, type Axis } from "@/lib/geom"
import { applyPoint, invert } from "@/lib/math/transform"
import {
  hardwareMotion,
  palletToMachineOf,
  partFrameOf,
  useCmmStore,
  type DroFrame,
} from "@/lib/store"
import { Home, RotateCcw, Ruler } from "lucide-react"

function AxisReadout({ axis, value }: { axis: Axis; value: number }) {
  const color = axis === "x" ? "text-red-500" : axis === "y" ? "text-lime-600 dark:text-lime-400" : "text-sky-500"
  return (
    <div className="rounded-lg bg-muted/70 px-2.5 py-2">
      <p className={`font-mono text-xs ${color}`}>{axis.toUpperCase()}</p>
      <p className="font-mono text-base leading-none tabular-nums">{value.toFixed(4)}</p>
      <p className="text-[10px] text-muted-foreground">mm</p>
    </div>
  )
}

const FRAMES: { value: DroFrame; label: string }[] = [
  { value: "machine", label: "机床" },
  { value: "pallet", label: "托盘" },
  { value: "part", label: "零件" },
]

export function MotionPanel() {
  const motion = useCmmStore((s) => s.motion)
  const dro = useCmmStore((s) => s.dro)
  const setDro = useCmmStore((s) => s.setDro)
  const calibration = useCmmStore((s) => s.calibration)
  const evaluation = useCmmStore((s) => s.evaluation)
  const jogSpeed = useCmmStore((s) => s.jogSpeed)
  const setJogSpeed = useCmmStore((s) => s.setJogSpeed)
  const startJog = useCmmStore((s) => s.startJog)
  const stopJog = useCmmStore((s) => s.stopJog)
  const home = useCmmStore((s) => s.home)
  const resetEstop = useCmmStore((s) => s.resetEstop)
  const running = useCmmStore((s) => s.running)
  const logs = useCmmStore((s) => s.logs)
  const dialReadings = useCmmStore((s) => s.dialReadings)
  const dialResult = useCmmStore((s) => s.dialResult)
  const dialInputMm = useCmmStore((s) => s.dialInputMm)
  const setDialInput = useCmmStore((s) => s.setDialInput)
  const recordDial = useCmmStore((s) => s.recordDial)
  const clearDial = useCmmStore((s) => s.clearDial)
  const hw = hardwareMotion.getSnapshot()

  const frame =
    dro === "machine"
      ? null
      : dro === "pallet"
        ? palletToMachineOf({ calibration })
        : partFrameOf({ calibration, evaluation })
  const shown = frame ? applyPoint(invert(frame), motion.position) : motion.position
  const disabled = running || motion.estop

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-3 py-2">
        <div className="flex items-center justify-between">
          <p className="text-[11px] tracking-wide text-muted-foreground">测针球心位置</p>
          <div className="flex gap-0.5 rounded-lg bg-muted p-0.5">
            {FRAMES.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setDro(f.value)}
                className={`rounded-md px-2 py-0.5 text-[11px] ${dro === f.value ? "bg-background shadow-sm" : "text-muted-foreground"}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          <AxisReadout axis="x" value={shown.x} />
          <AxisReadout axis="y" value={shown.y} />
          <AxisReadout axis="z" value={shown.z} />
        </div>
        {dro === "part" && !evaluation?.aligned ? (
          <p className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">零件坐标系未找正，当前按理论装夹显示</p>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge variant={motion.backend === "simulation" ? "secondary" : "outline"}>仿真控制器</Badge>
          <Badge variant={hw.connected ? "default" : "outline"}>{hw.connected ? "运控卡在线" : "运控卡未连接"}</Badge>
          {motion.homed ? <Badge variant="outline">已回零</Badge> : <Badge variant="destructive">未回零</Badge>}
          {motion.estop ? <Badge variant="destructive">急停锁定</Badge> : null}
          {motion.overtravel ? <Badge variant="destructive">{motion.overtravel.toUpperCase()} 超程</Badge> : null}
          {motion.mode === "probe" ? <Badge>触测</Badge> : motion.moving ? <Badge>运动中</Badge> : <Badge variant="outline">静止</Badge>}
        </div>
      </div>

      <div className="border-t px-3 py-2">
        <Label htmlFor="jog-speed" className="mb-2 text-[11px] text-muted-foreground">
          点动速度 {jogSpeed} mm/s
        </Label>
        <input
          id="jog-speed"
          type="range"
          min={1}
          max={120}
          value={jogSpeed}
          onChange={(e) => setJogSpeed(Number(e.target.value))}
          className="w-full accent-foreground"
        />
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {(["x", "y", "z"] as Axis[]).map((axis) => (
            <div key={axis} className="flex flex-col gap-1">
              {([1, -1] as const).map((dir) => (
                <Button
                  key={dir}
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onPointerDown={() => startJog(axis, dir)}
                  onPointerUp={stopJog}
                  onPointerLeave={stopJog}
                  onPointerCancel={stopJog}
                >
                  {axis.toUpperCase()}
                  {dir > 0 ? "+" : "−"}
                </Button>
              ))}
            </div>
          ))}
        </div>
        <div className="mt-2 flex gap-1.5">
          <Button size="sm" variant={motion.homed ? "secondary" : "default"} className="flex-1" disabled={disabled} onClick={() => void home()}>
            <Home data-icon="inline-start" />
            回零
          </Button>
          <Button size="sm" variant="outline" className="flex-1" disabled={!motion.estop} onClick={resetEstop}>
            <RotateCcw data-icon="inline-start" />
            复位急停
          </Button>
        </div>
      </div>

      <div className="border-t px-3 py-2">
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-[11px] text-muted-foreground">千分表找正</p>
          <span className="text-[10px] text-muted-foreground">{dialReadings.length} 点</span>
        </div>
        <p className="mb-2 text-[10px] leading-snug text-muted-foreground">
          表针靠上基准边，沿这条边点动，每停一处记下表的读数。行程超过 5 mm 后给出绕 Z 的转角。
        </p>
        <div className="flex items-end gap-1.5">
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <Label htmlFor="dial-reading" className="text-[11px] text-muted-foreground">
              当前读数 mm
            </Label>
            <Input
              id="dial-reading"
              type="number"
              step="0.001"
              value={dialInputMm}
              onChange={(e) => setDialInput(Number(e.target.value) || 0)}
              className="h-7 font-mono text-xs"
            />
          </label>
          <Button size="sm" variant="outline" disabled={disabled} onClick={recordDial}>
            <Ruler data-icon="inline-start" />
            记录
          </Button>
          <Button size="sm" variant="ghost" disabled={dialReadings.length === 0} onClick={clearDial}>
            清除
          </Button>
        </div>
        {dialResult ? (
          <p className="mt-1.5 font-mono text-[11px]">
            沿 {dialResult.travel.toUpperCase()} {dialResult.spanMm.toFixed(1)} mm · 转角 {dialResult.angleDeg.toFixed(4)}° · 变动{" "}
            {(dialResult.variationMm * 1000).toFixed(1)} μm
          </p>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 border-t">
        <p className="px-3 pt-2 text-[11px] text-muted-foreground">测量结果</p>
        {!evaluation ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">运行预检程序后，特征结果与装夹偏差显示在这里。</p>
        ) : (
          <ScrollArea className="h-full max-h-60">
            <ul className="space-y-1 px-3 py-1 text-xs">
              <li className="flex justify-between gap-2">
                <span>装夹偏差 X/Y/Z</span>
                <span className="font-mono text-muted-foreground">
                  {evaluation.pallet.delta.x.toFixed(3)} / {evaluation.pallet.delta.y.toFixed(3)} / {evaluation.pallet.delta.z.toFixed(3)}
                </span>
              </li>
              <li className="flex justify-between gap-2">
                <span>装夹转角</span>
                <span className="font-mono text-muted-foreground">{evaluation.pallet.delta.rz.toFixed(4)}°</span>
              </li>
              {evaluation.features
                .filter((f) => f.diameter !== undefined || !f.ok)
                .map((f) => (
                  <li key={f.stepId} className="flex justify-between gap-2">
                    <span className="truncate">{f.name}</span>
                    <span className={`shrink-0 font-mono ${f.ok ? "text-muted-foreground" : "text-destructive"}`}>
                      {f.ok ? `Ø${f.diameter!.toFixed(4)}` : "失败"}
                    </span>
                  </li>
                ))}
              {evaluation.gdt.map((g) => (
                <li key={g.checkId} className="flex justify-between gap-2">
                  <span className="truncate">{g.name}</span>
                  <span className={`shrink-0 font-mono ${g.passed ? "text-teal-600 dark:text-teal-400" : "text-destructive"}`}>
                    {g.passed ? "合格" : "超差"} {formatMm(g.value)}
                  </span>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col border-t">
        <p className="px-3 pt-2 text-[11px] text-muted-foreground">运行日志</p>
        <ScrollArea className="min-h-0 flex-1 px-3 pb-2">
          {logs.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">上电后请先回零，再标定托盘零点和测针。</p>
          ) : (
            <ul className="space-y-1 py-1">
              {logs.map((entry) => (
                <li key={entry.id} className="text-xs leading-snug">
                  <span className="mr-1 font-mono text-[10px] text-muted-foreground">{entry.at.slice(11, 19)}</span>
                  <span
                    className={
                      entry.level === "error"
                        ? "text-destructive"
                        : entry.level === "warn"
                          ? "text-amber-600 dark:text-amber-400"
                          : ""
                    }
                  >
                    {entry.message}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </div>
    </div>
  )
}
