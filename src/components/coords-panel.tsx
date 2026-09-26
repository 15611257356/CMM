"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { WORK_OFFSETS, workOffsetFromPose, workOffsetNc, type WorkOffsetCode } from "@/lib/coords/work-offset"
import { NOMINAL_PART_ON_PALLET, PALLET } from "@/lib/machine/setup"
import { toPoseDeg, type PoseDeg } from "@/lib/math/transform"
import { useCmmStore } from "@/lib/store"
import { Copy, Crosshair } from "lucide-react"
import type { ReactNode } from "react"

function Section({ title, badge, children }: { title: string; badge?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border p-3">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {badge}
      </div>
      {children}
    </section>
  )
}

function PoseRow({ label, pose, muted }: { label: string; pose: PoseDeg; muted?: boolean }) {
  const cell = "px-2 py-1 text-right font-mono tabular-nums"
  return (
    <tr className={`border-b border-border/60 ${muted ? "text-muted-foreground" : ""}`}>
      <td className="py-1 pr-2 text-left">{label}</td>
      <td className={cell}>{pose.x.toFixed(4)}</td>
      <td className={cell}>{pose.y.toFixed(4)}</td>
      <td className={cell}>{pose.z.toFixed(4)}</td>
      <td className={cell}>{pose.rz.toFixed(4)}</td>
      <td className={cell}>{pose.ry.toFixed(4)}</td>
      <td className={cell}>{pose.rx.toFixed(4)}</td>
    </tr>
  )
}

function PoseTable({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-xs">
        <thead>
          <tr className="border-b text-muted-foreground">
            <th className="py-1 pr-2 text-left font-medium" />
            <th className="px-2 py-1 text-right font-medium">X mm</th>
            <th className="px-2 py-1 text-right font-medium">Y mm</th>
            <th className="px-2 py-1 text-right font-medium">Z mm</th>
            <th className="px-2 py-1 text-right font-medium">绕Z °</th>
            <th className="px-2 py-1 text-right font-medium">绕Y °</th>
            <th className="px-2 py-1 text-right font-medium">绕X °</th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

function NumberField({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-[11px] text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        step="0.001"
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v)) onChange(v)
        }}
        className="font-mono"
      />
    </div>
  )
}

export function CoordsPanel() {
  const calibration = useCmmStore((s) => s.calibration)
  const evaluation = useCmmStore((s) => s.evaluation)
  const truth = useCmmStore((s) => s.truth)
  const machineTool = useCmmStore((s) => s.machineTool)
  const setMachineTool = useCmmStore((s) => s.setMachineTool)
  const withRotation = useCmmStore((s) => s.withRotation)
  const setWithRotation = useCmmStore((s) => s.setWithRotation)
  const calibratePallet = useCmmStore((s) => s.calibratePallet)
  const running = useCmmStore((s) => s.running)
  const homed = useCmmStore((s) => s.motion.homed)
  const log = useCmmStore((s) => s.log)

  const nominal = toPoseDeg(NOMINAL_PART_ON_PALLET)
  const offset = evaluation ? workOffsetFromPose(evaluation.pallet.actual, machineTool) : null
  const ncText = offset ? workOffsetNc(offset, withRotation) : ""
  const truthDelta: PoseDeg = {
    x: truth.partPose.x - nominal.x,
    y: truth.partPose.y - nominal.y,
    z: truth.partPose.z - nominal.z,
    rz: truth.partPose.rz - nominal.rz,
    ry: truth.partPose.ry - nominal.ry,
    rx: truth.partPose.rx - nominal.rx,
  }

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto flex max-w-4xl flex-col gap-3 p-4">
        <Section
          title="① 托盘零点与测针标定"
          badge={calibration ? <Badge variant="secondary">已标定</Badge> : <Badge variant="destructive">未标定</Badge>}
        >
          <p className="mb-2 text-xs text-muted-foreground">
            测托盘上 Ø{(PALLET.referenceSphere.radius * 2).toFixed(4)} mm 标准球：球心定出托盘零点在本机的位置，
            球心轨迹半径减去证书半径得到测针有效半径。换测针、撞针或每班开机都应重新标定。
          </p>
          {calibration ? (
            <dl className="mb-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
              <dt className="text-muted-foreground">测针有效半径</dt>
              <dd className="font-mono">{calibration.tipRadius.toFixed(4)} mm</dd>
              <dt className="text-muted-foreground">标准球形状误差</dt>
              <dd className="font-mono">{(calibration.sphereForm * 1000).toFixed(2)} μm</dd>
              <dt className="text-muted-foreground">托盘零点偏移（相对设计值）</dt>
              <dd className="col-span-3 font-mono">
                X {calibration.shift.x.toFixed(4)} · Y {calibration.shift.y.toFixed(4)} · Z {calibration.shift.z.toFixed(4)} mm
              </dd>
              <dt className="text-muted-foreground">标定时间</dt>
              <dd className="col-span-3 font-mono">{new Date(calibration.at).toLocaleString("zh-CN", { hour12: false })}</dd>
            </dl>
          ) : null}
          <Button size="sm" variant="outline" disabled={running || !homed} onClick={() => void calibratePallet()}>
            <Crosshair data-icon="inline-start" />
            {homed ? "标定托盘零点 / 测针" : "请先回零"}
          </Button>
        </Section>

        <Section
          title="② 零件坐标系（3-2-1 找正）"
          badge={evaluation?.aligned ? <Badge variant="secondary">已建立</Badge> : <Badge variant="outline">未建立</Badge>}
        >
          {evaluation ? (
            <>
              <p className="mb-2 text-xs text-muted-foreground">{evaluation.alignmentNote}</p>
              <p className="mb-1 text-xs text-muted-foreground">零件相对零点托盘（托盘坐标系，原点在托盘上表面中心）</p>
              <PoseTable>
                <PoseRow label="理论装夹" pose={evaluation.pallet.nominal} muted />
                <PoseRow label="实测装夹" pose={evaluation.pallet.actual} />
                <PoseRow label="偏差" pose={evaluation.pallet.delta} />
                <PoseRow label="仿真真值偏差" pose={truthDelta} muted />
              </PoseTable>
              <p className="mt-1 text-[11px] text-muted-foreground">
                「仿真真值偏差」只在仿真中存在，用来核对测量是否把零件的真实装夹偏差找回来了。
              </p>
              {evaluation.pallet.tiltWarning ? (
                <p className="mt-2 rounded-md bg-amber-500/10 px-2 py-1.5 text-xs text-amber-600 dark:text-amber-400">
                  {evaluation.pallet.tiltWarning}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              运行预检程序后，这里给出零件相对零点托盘的 X/Y/Z 偏差和转角。点「装新零件」可以换一个随机装偏的零件再测。
            </p>
          )}
        </Section>

        <Section title="③ 加工中心工件坐标系">
          <p className="mb-2 text-xs text-muted-foreground">
            托盘在加工中心上的零点只需首次标定一次，之后零点定位系统保证重复定位。工件坐标系 = 托盘零点 + 零件相对托盘的偏差。
          </p>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <NumberField
              id="pz-x"
              label="托盘零点 X（机床）"
              value={machineTool.palletZeroOnMachine.x}
              onChange={(x) => setMachineTool({ palletZeroOnMachine: { ...machineTool.palletZeroOnMachine, x } })}
            />
            <NumberField
              id="pz-y"
              label="托盘零点 Y（机床）"
              value={machineTool.palletZeroOnMachine.y}
              onChange={(y) => setMachineTool({ palletZeroOnMachine: { ...machineTool.palletZeroOnMachine, y } })}
            />
            <NumberField
              id="pz-z"
              label="托盘零点 Z（机床）"
              value={machineTool.palletZeroOnMachine.z}
              onChange={(z) => setMachineTool({ palletZeroOnMachine: { ...machineTool.palletZeroOnMachine, z } })}
            />
            <NumberField
              id="pz-r"
              label="托盘安装角 °"
              value={machineTool.palletRotationDeg}
              onChange={(palletRotationDeg) => setMachineTool({ palletRotationDeg })}
            />
            <div className="flex flex-col gap-1">
              <Label htmlFor="wo-reg" className="text-[11px] text-muted-foreground">
                写入寄存器
              </Label>
              <select
                id="wo-reg"
                value={machineTool.register}
                onChange={(e) => setMachineTool({ register: e.target.value as WorkOffsetCode })}
                className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm dark:bg-input/30"
              >
                {WORK_OFFSETS.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {offset ? (
            <>
              <dl className="mb-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                {(["x", "y", "z"] as const).map((axis) => (
                  <div key={axis} className="flex gap-2">
                    <dt className="text-muted-foreground">
                      {offset.register} {axis.toUpperCase()}
                    </dt>
                    <dd className="font-mono">{offset[axis].toFixed(4)}</dd>
                  </div>
                ))}
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">旋转</dt>
                  <dd className="font-mono">{offset.rotationDeg.toFixed(5)}°</dd>
                </div>
              </dl>
              <label className="mb-2 flex items-center gap-2 text-xs">
                <input type="checkbox" checked={withRotation} onChange={(e) => setWithRotation(e.target.checked)} />
                输出 G68 坐标旋转（机床需支持 G68；不支持时请改用「加工程序」页的改写模式）
              </label>
              <pre className="overflow-x-auto rounded-md bg-muted/60 p-2 font-mono text-xs leading-relaxed">{ncText}</pre>
              <Button
                size="xs"
                variant="outline"
                className="mt-2"
                onClick={() => {
                  void navigator.clipboard?.writeText(ncText)
                  log("info", `已复制 ${offset.register} 设定代码`)
                }}
              >
                <Copy data-icon="inline-start" />
                复制
              </Button>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">需要先完成预检测量。</p>
          )}
        </Section>
      </div>
    </ScrollArea>
  )
}
