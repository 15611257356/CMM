"use client"

import { MotionPanel } from "@/components/motion-panel"
import { ProgramPanel } from "@/components/program-panel"
import { ReportView } from "@/components/report-view"
import { VisionPanel } from "@/components/vision-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useCmmStore, type CenterView } from "@/lib/store"
import { OctagonAlert, Pause, Play } from "lucide-react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { useEffect } from "react"

const CmmScene = dynamic(() => import("@/components/cmm-scene").then((m) => m.CmmScene), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">加载 3D 机床…</div>
  ),
})

function HeaderBar() {
  const running = useCmmStore((s) => s.running)
  const paused = useCmmStore((s) => s.paused)
  const estop = useCmmStore((s) => s.motion.estop)
  const runProgram = useCmmStore((s) => s.runProgram)
  const togglePause = useCmmStore((s) => s.togglePause)
  const triggerEstop = useCmmStore((s) => s.estop)

  return (
    <header className="flex flex-wrap items-center gap-2 border-b bg-card px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/" className="text-sm font-semibold tracking-tight hover:underline sm:text-base">
            CMM 测量工作站
          </Link>
          <Badge variant="secondary">仿真模式</Badge>
          <Badge variant="outline" className="hidden sm:inline-flex">
            驱动层接口已预留
          </Badge>
        </div>
        <p className="hidden text-xs text-muted-foreground sm:block">
          桥式三坐标 · 测量程序 · 形位公差 · 视觉引导 · 不连接真实运控卡
        </p>
      </div>
      <div className="flex items-center gap-1.5">
        <Button size="sm" onClick={() => void runProgram()} disabled={running || estop}>
          <Play data-icon="inline-start" />
          运行
        </Button>
        <Button size="sm" variant="outline" onClick={togglePause} disabled={!running}>
          {paused ? <Play data-icon="inline-start" /> : <Pause data-icon="inline-start" />}
          {paused ? "继续" : "暂停"}
        </Button>
        <Button
          size="sm"
          className="bg-red-600 text-white hover:bg-red-500"
          onClick={triggerEstop}
        >
          <OctagonAlert data-icon="inline-start" />
          急停
        </Button>
      </div>
    </header>
  )
}

function CenterStage() {
  const view = useCmmStore((s) => s.view)
  const setView = useCmmStore((s) => s.setView)

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <Tabs value={view} onValueChange={(v) => setView(v as CenterView)} className="flex min-h-0 flex-1 gap-0">
        <div className="border-b px-2 py-1.5">
          <TabsList>
            <TabsTrigger value="machine">机床</TabsTrigger>
            <TabsTrigger value="vision">视觉</TabsTrigger>
            <TabsTrigger value="report">报告</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="machine" className="min-h-0">
          <div className="h-full min-h-[280px]">
            <CmmScene />
          </div>
        </TabsContent>
        <TabsContent value="vision" className="min-h-0">
          <VisionPanel />
        </TabsContent>
        <TabsContent value="report" className="min-h-0">
          <ReportView />
        </TabsContent>
      </Tabs>
    </div>
  )
}

export function Workstation() {
  const hydrate = useCmmStore((s) => s.hydrateFromStorage)
  useEffect(() => {
    hydrate()
  }, [hydrate])

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-background">
      <HeaderBar />
      <div className="hidden min-h-0 flex-1 lg:grid lg:grid-cols-[272px_minmax(0,1fr)_300px]">
        <aside className="min-h-0 border-r">
          <ProgramPanel />
        </aside>
        <CenterStage />
        <aside className="min-h-0 border-l">
          <MotionPanel />
        </aside>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:hidden">
        <MobileWorkspace />
      </div>
    </div>
  )
}

function MobileWorkspace() {
  return (
    <Tabs defaultValue="machine" className="flex min-h-0 flex-1 gap-0">
      <div className="border-b px-2 py-1.5">
        <TabsList className="w-full">
          <TabsTrigger value="program">程序</TabsTrigger>
          <TabsTrigger value="machine">机床</TabsTrigger>
          <TabsTrigger value="vision">视觉</TabsTrigger>
          <TabsTrigger value="motion">运动</TabsTrigger>
          <TabsTrigger value="report">报告</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="program" className="min-h-0 overflow-hidden">
        <ProgramPanel />
      </TabsContent>
      <TabsContent value="machine" className="min-h-0">
        <div className="h-full min-h-[320px]">
          <CmmScene />
        </div>
      </TabsContent>
      <TabsContent value="vision" className="min-h-0">
        <VisionPanel />
      </TabsContent>
      <TabsContent value="motion" className="min-h-0 overflow-hidden">
        <MotionPanel />
      </TabsContent>
      <TabsContent value="report" className="min-h-0">
        <ReportView />
      </TabsContent>
    </Tabs>
  )
}
