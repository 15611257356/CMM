"use client"

import { CoordsPanel } from "@/components/coords-panel"
import { MotionPanel } from "@/components/motion-panel"
import { NcPanel } from "@/components/nc-panel"
import { ProgramPanel } from "@/components/program-panel"
import { ReportView } from "@/components/report-view"
import { VisionPanel } from "@/components/vision-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useCmmStore, type CenterView } from "@/lib/store"
import { Crosshair, OctagonAlert, Pause, Play, Shuffle } from "lucide-react"
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
  const runLabel = useCmmStore((s) => s.runLabel)
  const paused = useCmmStore((s) => s.paused)
  const estop = useCmmStore((s) => s.motion.estop)
  const homed = useCmmStore((s) => s.motion.homed)
  const calibrated = useCmmStore((s) => Boolean(s.calibration))
  const runProgram = useCmmStore((s) => s.runProgram)
  const calibratePallet = useCmmStore((s) => s.calibratePallet)
  const loadNewPart = useCmmStore((s) => s.loadNewPart)
  const togglePause = useCmmStore((s) => s.togglePause)
  const triggerEstop = useCmmStore((s) => s.estop)
  const blocked = running || estop || !homed

  return (
    <header className="flex flex-wrap items-center gap-2 border-b bg-card px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/" className="text-sm font-semibold tracking-tight hover:underline sm:text-base">
            预检机 · 预调测量
          </Link>
          <Badge variant="secondary">仿真模式</Badge>
          {!homed ? <Badge variant="destructive">未回零</Badge> : null}
          <Badge variant={calibrated ? "outline" : "destructive"}>{calibrated ? "托盘/测针已标定" : "未标定"}</Badge>
          {running ? <Badge>{runLabel}中</Badge> : null}
        </div>
        <p className="hidden text-xs text-muted-foreground sm:block">
          零点托盘 · 测头找基准 · 自动建加工坐标系 · 改写加工程序 · 不连接真实运控卡
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="outline" onClick={loadNewPart} disabled={running}>
          <Shuffle data-icon="inline-start" />
          装新零件
        </Button>
        <Button size="sm" variant="outline" onClick={() => void calibratePallet()} disabled={blocked}>
          <Crosshair data-icon="inline-start" />
          标定
        </Button>
        <Button size="sm" onClick={() => void runProgram()} disabled={blocked}>
          <Play data-icon="inline-start" />
          运行预检
        </Button>
        <Button size="sm" variant="outline" onClick={togglePause} disabled={!running}>
          {paused ? <Play data-icon="inline-start" /> : <Pause data-icon="inline-start" />}
          {paused ? "继续" : "暂停"}
        </Button>
        <Button size="sm" className="bg-red-600 text-white hover:bg-red-500" onClick={triggerEstop}>
          <OctagonAlert data-icon="inline-start" />
          急停
        </Button>
      </div>
    </header>
  )
}

const CENTER_TABS: { value: CenterView; label: string }[] = [
  { value: "machine", label: "机床" },
  { value: "coords", label: "坐标系" },
  { value: "nc", label: "加工程序" },
  { value: "vision", label: "视觉" },
  { value: "report", label: "报告" },
]

function CenterContent({ view }: { view: CenterView }) {
  if (view === "machine") {
    return (
      <div className="h-full min-h-[300px]">
        <CmmScene />
      </div>
    )
  }
  if (view === "coords") return <CoordsPanel />
  if (view === "nc") return <NcPanel />
  if (view === "vision") return <VisionPanel />
  return <ReportView />
}

function CenterStage() {
  const stored = useCmmStore((s) => s.view)
  const setView = useCmmStore((s) => s.setView)
  const view = CENTER_TABS.some((t) => t.value === stored) ? stored : "machine"

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <Tabs value={view} onValueChange={(v) => setView(v as CenterView)} className="flex min-h-0 flex-1 gap-0">
        <div className="border-b px-2 py-1.5">
          <TabsList>
            {CENTER_TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {CENTER_TABS.map((t) => (
          <TabsContent key={t.value} value={t.value} className="min-h-0">
            <CenterContent view={t.value} />
          </TabsContent>
        ))}
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
      <div className="hidden min-h-0 flex-1 lg:grid lg:grid-cols-[280px_minmax(0,1fr)_310px]">
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
  const view = useCmmStore((s) => s.view)
  const setView = useCmmStore((s) => s.setView)
  return (
    <Tabs value={view} onValueChange={(v) => setView(v as CenterView)} className="flex min-h-0 flex-1 gap-0">
      <div className="overflow-x-auto border-b px-2 py-1.5">
        <TabsList>
          <TabsTrigger value="program">程序</TabsTrigger>
          {CENTER_TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
          <TabsTrigger value="motion">运动</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="program" className="min-h-0 overflow-hidden">
        <ProgramPanel />
      </TabsContent>
      {CENTER_TABS.map((t) => (
        <TabsContent key={t.value} value={t.value} className="min-h-0">
          <CenterContent view={t.value} />
        </TabsContent>
      ))}
      <TabsContent value="motion" className="min-h-0 overflow-hidden">
        <MotionPanel />
      </TabsContent>
    </Tabs>
  )
}
