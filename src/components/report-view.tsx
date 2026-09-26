"use client"

import { Button } from "@/components/ui/button"
import { formatMm } from "@/lib/geom"
import { GDT_LABEL, KIND_LABEL } from "@/lib/program/demo"
import type { FeatureResult } from "@/lib/program/types"
import { useCmmStore } from "@/lib/store"
import { Printer } from "lucide-react"

function featureText(f: FeatureResult): string {
  if (!f.ok) return `失败：${f.error ?? ""}`
  if (f.circle && f.inPart) {
    return `圆心 (${f.inPart.x.toFixed(4)}, ${f.inPart.y.toFixed(4)})  Ø${(f.circle.radius * 2).toFixed(4)}`
  }
  if (f.plane) return `平面度 ${formatMm(f.plane.flatness)}`
  if (f.line) return `直线度 ${formatMm(f.line.straightness)}`
  if (f.inPart) return `(${f.inPart.x.toFixed(4)}, ${f.inPart.y.toFixed(4)}, ${f.inPart.z.toFixed(4)})`
  return "—"
}

export function ReportView() {
  const report = useCmmStore((s) => s.report)
  const exportReport = useCmmStore((s) => s.exportReport)

  if (!report) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-sm font-medium">还没有预检报告</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          回零、标定后运行预检程序，结束后在这里汇总装夹偏差、特征结果与形位公差。
        </p>
      </div>
    )
  }

  const failed = report.gdt.filter((g) => !g.passed).length
  const when = new Date(report.createdAt).toLocaleString("zh-CN", { hour12: false })
  const d = report.palletDelta

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b px-4 py-2 print:hidden">
        <p className="text-sm text-muted-foreground">最近一次仿真预检 · {when}</p>
        <Button size="sm" onClick={exportReport}>
          <Printer data-icon="inline-start" />
          导出 / 打印
        </Button>
      </div>
      <div className="report-sheet min-h-0 flex-1 overflow-auto bg-background px-5 py-4">
        <header className="mb-4 border-b pb-3">
          <p className="text-xs tracking-[0.2em] text-muted-foreground">
            {report.mode === "post" ? "加工后复测报告" : "预调报告"} · 过程检查
          </p>
          <h1 className="text-xl font-semibold">{report.programName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {report.reportNo ? `${report.reportNo} · ` : ""}
            {report.partSerial ? `零件 ${report.partSerial} · ` : ""}
            {when} · 测针有效半径 {report.tipRadius.toFixed(4)} mm{report.calibrated ? "" : "（未标定，名义值）"}
            {report.thermal?.enabled
              ? ` · ${report.thermal.partTempC.toFixed(1)} °C 已换算到 20 °C`
              : ""}
            {report.mode === "post" ? ` · ${failed === 0 ? "全部公差合格" : `${failed} 项超差或无法评价`}` : ""}
          </p>
        </header>

        <section className="mb-5">
          <h2 className="mb-2 text-sm font-semibold">装夹偏差（相对零点托盘）</h2>
          <p className="mb-1 text-xs text-muted-foreground">{report.alignmentNote}</p>
          <p className="font-mono text-sm">
            ΔX {d.x.toFixed(4)} · ΔY {d.y.toFixed(4)} · ΔZ {d.z.toFixed(4)} mm · 转角 {d.rz.toFixed(4)}° · 倾斜{" "}
            {d.ry.toFixed(4)}° / {d.rx.toFixed(4)}°
          </p>
          {report.tiltWarning ? <p className="mt-1 text-sm text-destructive">{report.tiltWarning}</p> : null}
        </section>

        <section className="mb-5">
          <h2 className="mb-2 text-sm font-semibold">特征结果（零件坐标系）</h2>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-1.5 font-medium">特征</th>
                <th className="py-1.5 font-medium">类型</th>
                <th className="py-1.5 font-medium">结果</th>
              </tr>
            </thead>
            <tbody>
              {report.features.map((f) => (
                <tr key={f.stepId} className="border-b border-border/60">
                  <td className="py-1.5">{f.name}</td>
                  <td className="py-1.5 text-muted-foreground">{KIND_LABEL[f.kind]}</td>
                  <td className={`py-1.5 font-mono text-xs ${f.ok ? "" : "text-destructive"}`}>
                    {featureText(f)}
                    {f.sizeCheck
                      ? ` · ${f.sizeCheck.passed ? "尺寸合格" : "尺寸超差"} Δ${f.sizeCheck.deviation.toFixed(4)}（±${f.sizeCheck.tolerance.toFixed(3)}）`
                      : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold">形位公差（最小二乘评价）</h2>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-1.5 font-medium">项目</th>
                <th className="py-1.5 font-medium">类型</th>
                <th className="py-1.5 font-medium">实测</th>
                <th className="py-1.5 font-medium">公差</th>
                <th className="py-1.5 font-medium">判定</th>
              </tr>
            </thead>
            <tbody>
              {report.gdt.map((g) => (
                <tr key={g.checkId} className="border-b border-border/60">
                  <td className="py-1.5">{g.name}</td>
                  <td className="py-1.5">{GDT_LABEL[g.type]}</td>
                  <td className="py-1.5 font-mono">{formatMm(g.value)}</td>
                  <td className="py-1.5 font-mono">{formatMm(g.tolerance)}</td>
                  <td className={g.passed ? "py-1.5 text-teal-700 dark:text-teal-400" : "py-1.5 text-destructive"}>
                    {g.passed ? "合格" : Number.isFinite(g.value) ? "超差" : "无法评价"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <p className="mt-6 text-xs text-muted-foreground">
          本报告是预检过程检查，不能代替经鉴定合格的三坐标测量机出具的检测证书。
          {report.workOffset
            ? ` 工件坐标系 ${report.workOffset.register}：X ${report.workOffset.x.toFixed(4)} Y ${report.workOffset.y.toFixed(4)} Z ${report.workOffset.z.toFixed(4)}，绕 Z ${report.workOffset.rotationDeg.toFixed(4)}°。`
            : ""}
          运动控制与安全逻辑须由工程师终审后才能上机。
        </p>
      </div>
    </div>
  )
}
