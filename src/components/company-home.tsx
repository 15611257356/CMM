import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import Link from "next/link"

export function CompanyHome() {
  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b px-5 py-4">
        <p className="text-xs tracking-[0.2em] text-muted-foreground">制造工艺 · 起步阶段</p>
        <h1 className="mt-1 text-2xl font-semibold">舅舅公司</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          本阶段只做模块二：制造工艺规划与自动化加工支撑（CAPP）。先固化「如何加工」，再谈结构自动生成。
        </p>
      </header>

      <main className="mx-auto grid max-w-5xl gap-4 px-5 py-8 md:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CardTitle>CAPP 工艺自动生成</CardTitle>
              <Badge>本阶段主线</Badge>
            </div>
            <CardDescription>
              用工程师确认过的规则，给试点夹具零件自动生成工序顺序、毛坯建议和装夹方式，再由工程师标「可接受 / 需调整」。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
              <li>底板类、压板类各 5 个已完成案例</li>
              <li>工艺决策采集表（毛坯 / 工序 / 装夹）</li>
              <li>自动生成 + 对照实际工艺卡</li>
            </ul>
            <Link href="/capp">
              <Button className="w-full sm:w-auto">打开 CAPP 工作台</Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CardTitle>CMM 测量工作站</CardTitle>
              <Badge variant="outline">并行演示</Badge>
            </div>
            <CardDescription>
              三坐标仿真：3D 机床、测量程序、形位公差、视觉引导。不连真实运控卡。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/cmm">
              <Button variant="outline">打开测量工作站</Button>
            </Link>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
