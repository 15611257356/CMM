"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { formatMm } from "@/lib/geom"
import { hardwareMotion, useCmmStore } from "@/lib/store"
import { Home, RotateCcw } from "lucide-react"
import type { Axis } from "@/lib/geom"

function AxisReadout({ axis, value }: { axis: Axis; value: number }) {
  const color = axis === "x" ? "text-red-500" : axis === "y" ? "text-lime-600 dark:text-lime-400" : "text-sky-500"
  return (
    <div className="rounded-lg bg-muted/70 px-2.5 py-2">
      <p className={`font-mono text-xs ${color}`}>{axis.toUpperCase()}</p>
      <p className="font-mono text-lg leading-none tabular-nums">{value.toFixed(3)}</p>
      <p className="text-[10px] text-muted-foreground">mm</p>
    </div>
  )
}

export function MotionPanel() {
  const motion = useCmmStore((s) => s.motion)
  const jogSpeed = useCmmStore((s) => s.jogSpeed)
  const setJogSpeed = useCmmStore((s) => s.setJogSpeed)
  const startJog = useCmmStore((s) => s.startJog)
  const stopJog = useCmmStore((s) => s.stopJog)
  const home = useCmmStore((s) => s.home)
  const resetEstop = useCmmStore((s) => s.resetEstop)
  const running = useCmmStore((s) => s.running)
  const logs = useCmmStore((s) => s.logs)
  const results = useCmmStore((s) => s.results)
  const gdt = useCmmStore((s) => s.gdtResults)
  const hw = hardwareMotion.getSnapshot()

  const disabled = running || motion.estop

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-3 py-2">
        <p className="text-[11px] tracking-wide text-muted-foreground uppercase">轴位置</p>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          <AxisReadout axis="x" value={motion.position.x} />
          <AxisReadout axis="y" value={motion.position.y} />
          <AxisReadout axis="z" value={motion.position.z} />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge variant={motion.backend === "simulation" ? "secondary" : "outline"}>仿真控制器</Badge>
          <Badge variant={hw.connected ? "default" : "outline"}>
            {hw.connected ? "运控卡在线" : "运控卡未连接"}
          </Badge>
          {motion.estop ? <Badge variant="destructive">急停锁定</Badge> : null}
          {motion.overtravel ? <Badge variant="destructive">{motion.overtravel.toUpperCase()} 超程</Badge> : null}
          {motion.moving ? <Badge>运动中</Badge> : <Badge variant="outline">静止</Badge>}
        </div>
      </div>

      <div className="border-t px-3 py-2">
        <div className="mb-2 flex items-center justify-between">
          <Label htmlFor="jog-speed" className="text-[11px] text-muted-foreground">
            点动速度 {jogSpeed} mm/s
          </Label>
        </div>
        <input
          id="jog-speed"
          type="range"
          min={8}
          max={120}
          value={jogSpeed}
          onChange={(e) => setJogSpeed(Number(e.target.value))}
          className="w-full accent-foreground"
        />
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {(["x", "y", "z"] as Axis[]).map((axis) => (
            <div key={axis} className="flex flex-col gap-1">
              <Button
                size="sm"
                variant="outline"
                disabled={disabled}
                onPointerDown={() => startJog(axis, 1)}
                onPointerUp={stopJog}
                onPointerLeave={stopJog}
                onPointerCancel={stopJog}
              >
                {axis.toUpperCase()}+
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={disabled}
                onPointerDown={() => startJog(axis, -1)}
                onPointerUp={stopJog}
                onPointerLeave={stopJog}
                onPointerCancel={stopJog}
              >
                {axis.toUpperCase()}−
              </Button>
            </div>
          ))}
        </div>
        <div className="mt-2 flex gap-1.5">
          <Button size="sm" variant="secondary" className="flex-1" disabled={disabled} onClick={() => void home()}>
            <Home data-icon="inline-start" />
            回零
          </Button>
          <Button size="sm" variant="outline" className="flex-1" disabled={!motion.estop} onClick={resetEstop}>
            <RotateCcw data-icon="inline-start" />
            复位急停
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 border-t">
        <p className="px-3 pt-2 text-[11px] text-muted-foreground">测量结果</p>
        {results.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">运行程序后，拟合结果会显示在这里。</p>
        ) : (
          <ul className="space-y-1 px-3 py-1 text-xs">
            {results.map((r) => (
              <li key={r.stepId} className="flex justify-between gap-2">
                <span className="truncate">{r.name}</span>
                <span className="shrink-0 font-mono text-muted-foreground">
                  {r.plane ? `平面度 ${formatMm(r.plane.flatness)}` : null}
                  {r.circle ? `Ø${r.circle.radius.toFixed(3)}×2` : null}
                  {r.point ? `${r.point.x.toFixed(2)}, ${r.point.y.toFixed(2)}` : null}
                </span>
              </li>
            ))}
            {gdt.map((g) => (
              <li key={g.checkId} className="flex justify-between gap-2">
                <span className="truncate">{g.name}</span>
                <span className={`shrink-0 font-mono ${g.passed ? "text-teal-600 dark:text-teal-400" : "text-destructive"}`}>
                  {g.passed ? "合格" : "超差"} {formatMm(g.value)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col border-t">
        <p className="px-3 pt-2 text-[11px] text-muted-foreground">运行日志</p>
        <ScrollArea className="min-h-0 flex-1 px-3 pb-2">
          {logs.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">点动、运行或急停时会留下记录。</p>
          ) : (
            <ul className="space-y-1 py-1">
              {logs.map((entry) => (
                <li key={entry.id} className="text-xs leading-snug">
                  <span className="mr-1 font-mono text-[10px] text-muted-foreground">
                    {entry.at.slice(11, 19)}
                  </span>
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
