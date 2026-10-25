"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { formatMm, type Axis } from "@/lib/geom"
import { applyPoint, invert } from "@/lib/math/transform"
import { MACC_TEMP_PAIRING } from "@/lib/macc/errors"
import { DEFAULT_IPP_RELAY } from "@/lib/ipp/controller"
import { DEFAULT_MACC_BRIDGE } from "@/lib/macc/protocol"
import { setupToolSummary } from "@/lib/macc/setuptool"
import { palletToMachineOf, partFrameOf, useCmmStore, type DroFrame } from "@/lib/store"
import { Home, RotateCcw, Ruler } from "lucide-react"
import { useState } from "react"

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
  const nominalOnPallet = useCmmStore((s) => s.nominalOnPallet)
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
  const macc = useCmmStore((s) => s.macc)
  const driveHardware = useCmmStore((s) => s.driveHardware)
  const maccBusy = useCmmStore((s) => s.maccBusy)
  const connectMacc = useCmmStore((s) => s.connectMacc)
  const disconnectMacc = useCmmStore((s) => s.disconnectMacc)
  const setDriveHardware = useCmmStore((s) => s.setDriveHardware)
  const setMaccTemperatureComp = useCmmStore((s) => s.setMaccTemperatureComp)
  const setupTool = useCmmStore((s) => s.setupTool)
  const [bridgeUrl, setBridgeUrl] = useState(macc.bridgeUrl || DEFAULT_MACC_BRIDGE)
  const channel = useCmmStore((s) => s.hardwareChannel)
  const setHardwareChannel = useCmmStore((s) => s.setHardwareChannel)
  const ipp = useCmmStore((s) => s.ipp)
  const ippBusy = useCmmStore((s) => s.ippBusy)
  const connectIpp = useCmmStore((s) => s.connectIpp)
  const disconnectIpp = useCmmStore((s) => s.disconnectIpp)
  const ippSurfacePoint = useCmmStore((s) => s.ippSurfacePoint)
  const setIppSurfacePoint = useCmmStore((s) => s.setIppReturnsSurfacePoint)
  const [ippUrl, setIppUrl] = useState(ipp.url || DEFAULT_IPP_RELAY)

  const frame =
    dro === "machine"
      ? null
      : dro === "pallet"
        ? palletToMachineOf({ calibration })
        : partFrameOf({ calibration, evaluation, nominalOnPallet })
  const shown = frame ? applyPoint(invert(frame), motion.position) : motion.position
  const disabled = running || motion.estop

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
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
          <Badge variant={driveHardware ? "default" : "secondary"}>
            {driveHardware ? (channel === "ipp" ? "I++ 真机" : "MACC 真机") : "仿真控制器"}
          </Badge>
          {motion.homed ? <Badge variant="outline">已回零</Badge> : <Badge variant="destructive">未回零</Badge>}
          {motion.estop ? <Badge variant="destructive">急停锁定</Badge> : null}
          {motion.overtravel ? <Badge variant="destructive">{motion.overtravel.toUpperCase()} 超程</Badge> : null}
          {motion.mode === "probe" ? (
            <Badge>触测</Badge>
          ) : motion.moving ? (
            <Badge>运动中</Badge>
          ) : (
            <Badge variant="outline">静止</Badge>
          )}
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
          <Button
            size="sm"
            variant={motion.homed ? "secondary" : "default"}
            className="flex-1"
            disabled={disabled}
            onClick={() => void home()}
          >
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

      <div className="border-t px-3 py-2">
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-[11px] text-muted-foreground">真机通道</p>
          <div className="flex gap-0.5 rounded-lg bg-muted p-0.5">
            {(
              [
                ["ipp", "IPPServer (I++)"],
                ["macc", "MACC 桥接"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                disabled={running}
                onClick={() => setHardwareChannel(value)}
                className={`rounded-md px-2 py-0.5 text-[11px] ${channel === value ? "bg-background shadow-sm" : "text-muted-foreground"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {channel === "ipp" ? (
          <>
            <input
              value={ippUrl}
              onChange={(e) => setIppUrl(e.target.value)}
              className="mb-1.5 h-8 w-full rounded-lg border border-input bg-transparent px-2 font-mono text-xs"
              spellCheck={false}
            />
            <div className="flex flex-wrap items-center gap-1.5">
              {ipp.connected ? (
                <Button size="xs" variant="outline" onClick={disconnectIpp} disabled={ippBusy}>
                  断开
                </Button>
              ) : (
                <Button size="xs" onClick={() => void connectIpp(ippUrl)} disabled={ippBusy}>
                  {ippBusy ? "连接中…" : "连接 IPPServer"}
                </Button>
              )}
              <Badge variant={ipp.connected ? "default" : "outline"}>{ipp.connected ? "I++ 在线" : "I++ 未连接"}</Badge>
              {ipp.connected ? (
                <Badge variant={ipp.homed ? "outline" : "destructive"}>{ipp.homed ? "已回零" : "未回零"}</Badge>
              ) : null}
            </div>
            <label className="mt-2 flex items-center gap-2 text-xs">
              <input type="checkbox" checked={ippSurfacePoint} onChange={(e) => setIppSurfacePoint(e.target.checked)} />
              PtMeas 返回已补偿测针半径的表面点
            </label>
            {ipp.lastError ? <p className="mt-1 text-[10px] text-destructive">{ipp.lastError}</p> : null}
            {ipp.traffic.length ? (
              <pre className="mt-1.5 max-h-28 overflow-y-auto rounded-md bg-muted/70 p-1.5 font-mono text-[10px] leading-snug whitespace-pre-wrap">
                {ipp.traffic.slice(-10).join("\n")}
              </pre>
            ) : (
              <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
                工控机上打开 IPPServer（端口 1294），再运行 <code>node tools/ipp-relay.mjs</code> 把浏览器 WebSocket 转成 TCP。
                没有机床时用 <code>node tools/ipp-mock-server.mjs</code> 联调。
              </p>
            )}
          </>
        ) : (
          <>
            <input
              value={bridgeUrl}
              onChange={(e) => setBridgeUrl(e.target.value)}
              className="mb-1.5 h-8 w-full rounded-lg border border-input bg-transparent px-2 font-mono text-xs"
              spellCheck={false}
            />
            <div className="flex flex-wrap gap-1.5">
              {macc.connected ? (
                <Button size="xs" variant="outline" onClick={disconnectMacc} disabled={maccBusy}>
                  断开
                </Button>
              ) : (
                <Button size="xs" onClick={() => void connectMacc(bridgeUrl)} disabled={maccBusy}>
                  {maccBusy ? "连接中…" : "连接桥接"}
                </Button>
              )}
            </div>
            {macc.connected ? (
              <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-0.5 font-mono text-[11px] text-muted-foreground">
                <dt>序列号</dt>
                <dd className="truncate">{macc.serial || "—"}</dd>
                <dt>固件 F/D</dt>
                <dd className="truncate">
                  {macc.firmwareF || "—"} / {macc.firmwareD || "—"}
                </dd>
                <dt>工件温度</dt>
                <dd>{macc.partTempC === null ? "—" : `${macc.partTempC.toFixed(2)} °C`}</dd>
              </dl>
            ) : null}
            <label className="mt-1 flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={macc.temperatureComp}
                disabled={!macc.connected}
                onChange={(e) => void setMaccTemperatureComp(e.target.checked)}
              />
              使能控制器温度补偿
            </label>
            <p className="mt-1 text-[10px] leading-snug text-amber-600 dark:text-amber-400">{MACC_TEMP_PAIRING.note}</p>
          </>
        )}
        <label className="mt-2 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={driveHardware}
            disabled={channel === "ipp" ? !ipp.connected : !macc.connected}
            onChange={(e) => setDriveHardware(e.target.checked)}
          />
          回零/自动运行走真机（未勾选仍是仿真）
        </label>
        <p className="mt-1 text-[10px] text-muted-foreground">
          {setupTool ? setupToolSummary(setupTool) : "可从程序面板导入 VCC 调试软件 V3.41 / SetupTool V3.33 的 Config/config.xml"}
        </p>
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
                  {evaluation.pallet.delta.x.toFixed(3)} / {evaluation.pallet.delta.y.toFixed(3)} /{" "}
                  {evaluation.pallet.delta.z.toFixed(3)}
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
