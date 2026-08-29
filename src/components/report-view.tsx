"use client"

import { Button } from "@/components/ui/button"
import { formatMm } from "@/lib/geom"
import { GDT_LABEL } from "@/lib/program/demo"
import { useCmmStore } from "@/lib/store"
import { Printer } from "lucide-react"

export function ReportView() {
  const report = useCmmStore((s) => s.report)
  const exportReport = useCmmStore((s) => s.exportReport)

  if (!report) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-sm font-medium">还没有测量报告</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          先在机床视图运行示例程序。测量结束后会在这里汇总特征拟合与形位公差。
        </p>
      </div>
    )
  }

  const failed = report.gdt.filter((g) => !g.passed).length
  const when = new Date(report.createdAt).toLocaleString("zh-CN", { hour12: false })

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b px-4 py-2 print:hidden">
        <p className="text-sm text-muted-foreground">最近一次仿真测量 · {when}</p>
        <Button size="sm" onClick={exportReport}>
          <Printer data-icon="inline-start" />
          导出 / 打印
        </Button>
      </div>
      <div className="report-sheet min-h-0 flex-1 overflow-auto bg-background px-5 py-4">
        <header className="mb-4 border-b pb-3">
          <p className="text-xs tracking-[0.2em] text-muted-foreground">CMM 测量报告</p>
          <h1 className="text-xl font-semibold">{report.programName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            仿真测头采点 · {when} · {failed === 0 ? "全部公差合格" : `${failed} 项超差`}
          </p>
        </header>

        <section className="mb-5">
          <h2 className="mb-2 text-sm font-semibold">特征结果</h2>
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
                  <td className="py-1.5 text-muted-foreground">
                    {f.kind === "plane" ? "平面" : f.kind === "circle" ? "圆" : "点"}
                  </td>
                  <td className="py-1.5 font-mono text-xs">
                    {f.plane ? `平面度 ${formatMm(f.plane.flatness)}` : null}
                    {f.circle
                      ? `圆心 (${f.circle.cx.toFixed(3)}, ${f.circle.cy.toFixed(3)})  半径 ${formatMm(f.circle.radius)}`
                      : null}
                    {f.point ? `(${f.point.x.toFixed(3)}, ${f.point.y.toFixed(3)}, ${f.point.z.toFixed(3)})` : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold">形位公差</h2>
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
                    {g.passed ? "合格" : "超差"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <p className="mt-6 text-xs text-muted-foreground">
          本报告来自软件仿真，不能替代标准量块标定或真实三坐标检定。运动控制与安全逻辑须由工程师终审后才能上机。
        </p>
      </div>
    </div>
  )
}
