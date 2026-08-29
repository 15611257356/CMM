"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { hardwareCamera, useCmmStore } from "@/lib/store"
import { CameraOff, ImagePlus, ScanSearch, WandSparkles } from "lucide-react"
import { useRef } from "react"

export function VisionPanel() {
  const image = useCmmStore((s) => s.visionImage)
  const detections = useCmmStore((s) => s.visionDetections)
  const error = useCmmStore((s) => s.visionError)
  const busy = useCmmStore((s) => s.visionBusy)
  const running = useCmmStore((s) => s.running)
  const loadSample = useCmmStore((s) => s.loadSampleVision)
  const upload = useCmmStore((s) => s.uploadVision)
  const detect = useCmmStore((s) => s.detectVision)
  const apply = useCmmStore((s) => s.applyVisionSteps)
  const inputRef = useRef<HTMLInputElement>(null)
  const camera = hardwareCamera.isConnected()

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Badge variant={camera ? "default" : "outline"}>
          <CameraOff data-icon="inline-start" />
          {camera ? "相机在线" : "文件 / 示意图模式"}
        </Badge>
        <p className="text-xs text-muted-foreground">当前不是工业相机取流，识别仅用于引导测量演示。</p>
      </div>

      <div className="relative min-h-0 flex-1 bg-[#16181d]">
        {!image ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-sm font-medium">没有图像</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              加载内置平板四孔示意图，或上传一张俯视工件图。识别圆孔后可写入测量程序。
            </p>
          </div>
        ) : (
          <div className="relative mx-auto flex h-full max-w-3xl items-center justify-center p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image} alt="视觉工件" className="max-h-full max-w-full object-contain" />
            {detections.length > 0 ? <VisionOverlay /> : null}
          </div>
        )}
      </div>

      {error ? (
        <div className="border-t bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      ) : null}

      {detections.length > 0 ? (
        <div className="border-t px-3 py-2 text-xs text-muted-foreground">
          识别到 {detections.length} 个圆孔
          {detections.map((d, i) => (
            <span key={d.id} className="ml-2 font-mono">
              #{i + 1} ({d.x.toFixed(1)}, {d.y.toFixed(1)}) r={d.radius.toFixed(1)}
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-1.5 border-t px-3 py-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void upload(file)
            e.target.value = ""
          }}
        />
        <Button size="sm" variant="outline" onClick={loadSample} disabled={running}>
          加载示例图
        </Button>
        <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()} disabled={running}>
          <ImagePlus data-icon="inline-start" />
          上传图片
        </Button>
        <Button size="sm" onClick={() => void detect()} disabled={!image || busy || running}>
          <ScanSearch data-icon="inline-start" />
          {busy ? "识别中…" : "识别圆孔"}
        </Button>
        <Button size="sm" variant="secondary" onClick={apply} disabled={!detections.length || running}>
          <WandSparkles data-icon="inline-start" />
          生成测量步骤
        </Button>
      </div>
    </div>
  )
}

function VisionOverlay() {
  const detections = useCmmStore((s) => s.visionDetections)
  const image = useCmmStore((s) => s.visionImage)
  const size = useCmmStore((s) => s.visionSize)
  if (!image || detections.length === 0) return null
  const w = size?.w ?? 480
  const h = size?.h ?? 336
  return (
    <svg
      className="pointer-events-none absolute inset-3"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {detections.map((d, i) => (
        <g key={d.id}>
          <circle cx={d.px} cy={d.py} r={d.radiusPx} fill="none" stroke="#22d3ee" strokeWidth="2" />
          <text x={d.px + 8} y={d.py - 8} fill="#22d3ee" fontSize="12">
            {i + 1}
          </text>
        </g>
      ))}
    </svg>
  )
}
