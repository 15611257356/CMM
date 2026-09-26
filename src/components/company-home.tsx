import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import Link from "next/link"

export function CompanyHome() {
  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b px-5 py-4">
        <p className="text-xs tracking-[0.2em] text-muted-foreground">舅舅公司 · 智能装备</p>
        <h1 className="mt-1 text-2xl font-semibold">预检机（预调 + 测量）</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          零件装在零点托盘上，测头自动找基准，建立新的加工坐标系并改写加工程序，机床不用再找正；加工后回到预检机测量尺寸与形位公差。
        </p>
      </header>

      <main className="mx-auto grid max-w-5xl gap-4 px-5 py-8 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-2">
              <CardTitle>预检机工作站</CardTitle>
              <Badge>主线</Badge>
            </div>
            <CardDescription>仿真模式：3D 机床、零点托盘、测头触测、3-2-1 找正、G54~G59 输出、加工程序改写。不连真实运控卡。</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <ol className="list-decimal space-y-1 pl-4 text-sm text-muted-foreground">
              <li>回零，用托盘上的标准球标定托盘零点和测针</li>
              <li>装零件，运行预检程序：上表面 / 前侧边 / 左侧点找正，再测孔</li>
              <li>得到零件相对托盘的 X/Y/Z 偏差和转角，输出工件坐标系或改写程序</li>
            </ol>
            <Link href="/cmm">
              <Button className="w-full sm:w-auto">打开预检机工作站</Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CardTitle>CAPP 工艺规划</CardTitle>
              <Badge variant="outline">暂停</Badge>
            </div>
            <CardDescription>上一阶段的工艺路线原型，新需求里未包含，保留代码不再迭代。</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/capp">
              <Button variant="outline">查看</Button>
            </Link>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
