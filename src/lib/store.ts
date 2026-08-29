"use client"

import { coaxiality, fitCircle, fitPlane, positionDeviation } from "@/lib/measure/gdt"
import { HardwareMotionController } from "@/lib/motion/hardware-stub"
import { SimulatedMotionController } from "@/lib/motion/simulated-controller"
import { MotionError, type MotionSnapshot } from "@/lib/motion/types"
import { cloneVec, MACHINE, PLATE, uid, type Axis, type Vec3 } from "@/lib/geom"
import { createDemoProgram } from "@/lib/program/demo"
import type {
  FeatureResult,
  GdtResult,
  LogEntry,
  LogLevel,
  MeasurementProgram,
  ProgramStep,
  ReportSnapshot,
} from "@/lib/program/types"
import { HardwareCameraDriver } from "@/lib/vision/camera"
import { detectCircles, imageDataFromUrl } from "@/lib/vision/detect"
import { createSamplePlateImage, sampleCalibration } from "@/lib/vision/sample-image"
import type { DetectedCircle } from "@/lib/vision/types"
import { create } from "zustand"

const PROGRAM_KEY = "cmm-program-v1"
const REPORT_KEY = "cmm-last-report-v1"

export type CenterView = "machine" | "vision" | "report"

export const motion = new SimulatedMotionController()
export const hardwareMotion = new HardwareMotionController()
export const hardwareCamera = new HardwareCameraDriver()

function loadProgram(): MeasurementProgram {
  if (typeof window === "undefined") return createDemoProgram()
  try {
    const raw = localStorage.getItem(PROGRAM_KEY)
    if (!raw) return createDemoProgram()
    const parsed = JSON.parse(raw) as MeasurementProgram
    if (!parsed?.steps?.length) return createDemoProgram()
    return parsed
  } catch {
    return createDemoProgram()
  }
}

function persistProgram(program: MeasurementProgram) {
  localStorage.setItem(PROGRAM_KEY, JSON.stringify(program))
}

function loadReport(): ReportSnapshot | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem(REPORT_KEY)
    return raw ? (JSON.parse(raw) as ReportSnapshot) : null
  } catch {
    return null
  }
}

function nowIso() {
  return new Date().toISOString()
}

function probeNoise(nominal: Vec3): Vec3 {
  const n = () => (Math.random() - 0.5) * 0.012
  return { x: nominal.x + n(), y: nominal.y + n(), z: nominal.z + n() * 0.4 }
}

function circleFromVision(hit: DetectedCircle, index: number): ProgramStep {
  const angles = [0, 90, 180, 270]
  return {
    id: uid("feat"),
    kind: "circle",
    name: `视觉孔${index + 1}`,
    nominalCenter: { x: hit.x, y: hit.y, z: hit.z },
    nominalRadius: hit.radius,
    points: angles.map((deg) => {
      const rad = (deg * Math.PI) / 180
      return {
        id: uid("pt"),
        nominal: {
          x: hit.x + hit.radius * Math.cos(rad),
          y: hit.y + hit.radius * Math.sin(rad),
          z: hit.z,
        },
      }
    }),
  }
}

type AppState = {
  motion: MotionSnapshot
  program: MeasurementProgram
  selectedStepId: string | null
  currentStepId: string | null
  running: boolean
  paused: boolean
  abortRequested: boolean
  results: FeatureResult[]
  gdtResults: GdtResult[]
  report: ReportSnapshot | null
  logs: LogEntry[]
  view: CenterView
  jogSpeed: number
  measureSpeed: number
  rapidSpeed: number
  visionImage: string | null
  visionDetections: DetectedCircle[]
  visionError: string | null
  visionBusy: boolean
  hardwareNote: string
  log: (level: LogLevel, message: string) => void
  setView: (view: CenterView) => void
  setSelectedStep: (id: string | null) => void
  setJogSpeed: (speed: number) => void
  persist: () => void
  resetDemoProgram: () => void
  addStep: (kind: ProgramStep["kind"]) => void
  removeStep: (id: string) => void
  startJog: (axis: Axis, direction: 1 | -1) => void
  stopJog: () => void
  home: () => Promise<void>
  estop: () => void
  resetEstop: () => void
  runProgram: () => Promise<void>
  togglePause: () => void
  loadSampleVision: () => void
  uploadVision: (file: File) => Promise<void>
  detectVision: () => Promise<void>
  applyVisionSteps: () => void
  exportReport: () => void
}

export const useCmmStore = create<AppState>((set, get) => ({
  motion: motion.getSnapshot(),
  program: loadProgram(),
  selectedStepId: null,
  currentStepId: null,
  running: false,
  paused: false,
  abortRequested: false,
  results: [],
  gdtResults: [],
  report: loadReport(),
  logs: [],
  view: "machine",
  jogSpeed: 40,
  measureSpeed: 90,
  rapidSpeed: 280,
  visionImage: null,
  visionDetections: [],
  visionError: null,
  visionBusy: false,
  hardwareNote: hardwareCamera.isConnected() ? "相机已连接" : "工业相机未连接 · 使用示意图或上传图片",

  log: (level, message) =>
    set((s) => ({
      logs: [{ id: uid("log"), at: nowIso(), level, message }, ...s.logs].slice(0, 80),
    })),

  setView: (view) => set({ view }),
  setSelectedStep: (id) => set({ selectedStepId: id }),
  setJogSpeed: (speed) => set({ jogSpeed: speed }),

  persist: () => persistProgram(get().program),

  resetDemoProgram: () => {
    const program = createDemoProgram()
    persistProgram(program)
    set({ program, results: [], gdtResults: [], selectedStepId: null, currentStepId: null })
    get().log("info", "已恢复平板四孔示例程序")
  },

  addStep: (kind) => {
    const pos = get().motion.position
    let step: ProgramStep
    if (kind === "point") {
      step = {
        id: uid("feat"),
        kind,
        name: `点${get().program.steps.filter((s) => s.kind === "point").length + 1}`,
        points: [{ id: uid("pt"), nominal: cloneVec(pos) }],
      }
    } else if (kind === "plane") {
      const z = PLATE.z + PLATE.h
      step = {
        id: uid("feat"),
        kind,
        name: `平面${get().program.steps.filter((s) => s.kind === "plane").length + 1}`,
        points: [
          { x: pos.x - 20, y: pos.y - 20, z },
          { x: pos.x + 20, y: pos.y - 20, z },
          { x: pos.x + 20, y: pos.y + 20, z },
          { x: pos.x - 20, y: pos.y + 20, z },
        ].map((nominal) => ({ id: uid("pt"), nominal })),
      }
    } else {
      const z = PLATE.z + PLATE.h
      const r = 10
      step = {
        id: uid("feat"),
        kind,
        name: `圆${get().program.steps.filter((s) => s.kind === "circle").length + 1}`,
        nominalCenter: { x: pos.x, y: pos.y, z },
        nominalRadius: r,
        points: [0, 90, 180, 270].map((deg) => {
          const rad = (deg * Math.PI) / 180
          return {
            id: uid("pt"),
            nominal: { x: pos.x + r * Math.cos(rad), y: pos.y + r * Math.sin(rad), z },
          }
        }),
      }
    }
    set((s) => {
      const gdt = [...s.program.gdt]
      if (kind === "plane") {
        gdt.push({
          id: uid("gdt"),
          type: "flatness",
          name: `${step.name}平面度`,
          featureIds: [step.id],
          tolerance: 0.02,
        })
      }
      if (kind === "circle") {
        gdt.push({
          id: uid("gdt"),
          type: "circularity",
          name: `${step.name}圆度`,
          featureIds: [step.id],
          tolerance: 0.015,
        })
        gdt.push({
          id: uid("gdt"),
          type: "position",
          name: `${step.name}位置度`,
          featureIds: [step.id],
          tolerance: 0.05,
        })
      }
      const program = { ...s.program, steps: [...s.program.steps, step], gdt }
      persistProgram(program)
      return { program, selectedStepId: step.id }
    })
    get().log("info", `已添加特征「${step.name}」`)
  },

  removeStep: (id) => {
    set((s) => {
      const program = {
        ...s.program,
        steps: s.program.steps.filter((step) => step.id !== id),
        gdt: s.program.gdt.filter((check) => !check.featureIds.includes(id)),
      }
      persistProgram(program)
      return {
        program,
        selectedStepId: s.selectedStepId === id ? null : s.selectedStepId,
      }
    })
    get().log("info", "已删除特征")
  },

  startJog: (axis, direction) => {
    try {
      motion.jog(axis, direction, get().jogSpeed)
      get().log("info", `点动 ${axis.toUpperCase()} ${direction > 0 ? "+" : "-"}`)
    } catch (error) {
      get().log("error", error instanceof Error ? error.message : "点动失败")
    }
  },

  stopJog: () => motion.stopJog(),

  home: async () => {
    try {
      get().log("info", "回零中…")
      await motion.home(get().rapidSpeed)
      get().log("info", "已回到机械原点")
    } catch (error) {
      get().log("error", error instanceof Error ? error.message : "回零失败")
    }
  },

  estop: () => {
    set({ abortRequested: true, paused: false })
    motion.estop()
    get().log("error", "急停已触发，所有运动已切断")
  },

  resetEstop: () => {
    motion.resetEstop()
    set({ abortRequested: false })
    get().log("info", "急停已复位")
  },

  togglePause: () => {
    if (!get().running) return
    set((s) => ({ paused: !s.paused }))
    get().log("warn", get().paused ? "测量已暂停" : "测量继续")
  },

  runProgram: async () => {
    const { program, running, rapidSpeed, measureSpeed } = get()
    if (running) return
    if (!program.steps.length) {
      get().log("warn", "程序为空，请先加载示例或添加特征")
      return
    }
    set({
      running: true,
      paused: false,
      abortRequested: false,
      results: [],
      gdtResults: [],
      currentStepId: program.steps[0]?.id ?? null,
    })
    get().log("info", `开始运行「${program.name}」`)

    const waitIfPaused = async () => {
      while (get().paused && !get().abortRequested) {
        await new Promise((r) => setTimeout(r, 80))
      }
    }

    const results: FeatureResult[] = []
    try {
      for (const step of program.steps) {
        if (get().abortRequested) throw new MotionError("程序被中止", "estop")
        set({ currentStepId: step.id, selectedStepId: step.id })
        get().log("info", `测量 ${step.name}`)
        const measuredPoints: Vec3[] = []
        for (const point of step.points) {
          await waitIfPaused()
          if (get().abortRequested) throw new MotionError("程序被中止", "estop")
          const approach = { ...point.nominal, z: Math.min(MACHINE.zMax, point.nominal.z + 16) }
          await motion.moveTo(approach, rapidSpeed)
          await waitIfPaused()
          await motion.moveTo(point.nominal, measureSpeed)
          const measured = probeNoise(point.nominal)
          measuredPoints.push(measured)
          point.measured = measured
          await motion.moveTo(approach, measureSpeed)
        }

        const result: FeatureResult = { stepId: step.id, name: step.name, kind: step.kind }
        if (step.kind === "plane") result.plane = fitPlane(measuredPoints)
        if (step.kind === "circle") result.circle = fitCircle(measuredPoints)
        if (step.kind === "point") result.point = measuredPoints[0]
        results.push(result)
        set({ results: [...results] })
      }

      const gdtResults: GdtResult[] = program.gdt.map((check) => {
        const feats = check.featureIds.map((id) => results.find((r) => r.stepId === id))
        let value = NaN
        if (check.type === "flatness" && feats[0]?.plane) value = feats[0].plane.flatness
        if (check.type === "circularity" && feats[0]?.circle) value = feats[0].circle.circularity
        if (check.type === "position" && feats[0]?.circle) {
          const step = program.steps.find((s) => s.id === check.featureIds[0])
          const nom = step?.nominalCenter ?? { x: 0, y: 0 }
          value = positionDeviation({ x: feats[0].circle.cx, y: feats[0].circle.cy }, nom)
        }
        if (check.type === "coaxiality" && feats[0]?.circle && feats[1]?.circle) {
          value = coaxiality(feats[0].circle, feats[1].circle)
        }
        return {
          checkId: check.id,
          name: check.name,
          type: check.type,
          value,
          tolerance: check.tolerance,
          passed: Number.isFinite(value) && value <= check.tolerance,
        }
      })

      const report: ReportSnapshot = {
        createdAt: nowIso(),
        programName: program.name,
        features: results,
        gdt: gdtResults,
      }
      localStorage.setItem(REPORT_KEY, JSON.stringify(report))
      set({ gdtResults, report, program: { ...program } })
      persistProgram(program)
      await motion.moveTo({ ...get().motion.position, z: MACHINE.zMax }, rapidSpeed)
      get().log("info", "测量完成，报告已生成")
    } catch (error) {
      const message = error instanceof Error ? error.message : "运行失败"
      get().log("error", message)
    } finally {
      set({ running: false, paused: false, currentStepId: null, abortRequested: false })
    }
  },

  loadSampleVision: () => {
    const url = createSamplePlateImage()
    set({
      visionImage: url,
      visionDetections: [],
      visionError: null,
      view: "vision",
    })
    get().log("info", "已加载示例工件图（非工业相机）")
  },

  uploadVision: async (file) => {
    const url = URL.createObjectURL(file)
    set({
      visionImage: url,
      visionDetections: [],
      visionError: null,
      view: "vision",
    })
    get().log("info", `已导入图片 ${file.name}，按板面铺满画面做演示标定`)
  },

  detectVision: async () => {
    const url = get().visionImage
    if (!url) {
      set({ visionError: "请先加载示例图或上传图片" })
      return
    }
    set({ visionBusy: true, visionError: null })
    try {
      const image = await imageDataFromUrl(url)
      const cal =
        url.startsWith("data:") && image.width === 480
          ? sampleCalibration()
          : {
              imageWidth: image.width,
              imageHeight: image.height,
              padX: Math.round(image.width * 0.06),
              padY: Math.round(image.height * 0.07),
            }
      const detections = detectCircles(image, cal)
      if (!detections.length) {
        set({
          visionDetections: [],
          visionError: "未识别到圆孔。请使用对比清晰的俯视工件图，或先加载示例图。",
        })
        get().log("warn", "视觉识别未找到圆孔")
        return
      }
      set({ visionDetections: detections, visionError: null })
      get().log("info", `识别到 ${detections.length} 个圆孔`)
    } catch (error) {
      const message = error instanceof Error ? error.message : "识别失败"
      set({ visionError: message })
      get().log("error", message)
    } finally {
      set({ visionBusy: false })
    }
  },

  applyVisionSteps: () => {
    const hits = get().visionDetections
    if (!hits.length) {
      get().log("warn", "没有识别结果可写入程序")
      return
    }
    set((s) => {
      const steps = hits.map((hit, index) => circleFromVision(hit, index))
      const gdt = steps.flatMap((step) => [
        {
          id: uid("gdt"),
          type: "circularity" as const,
          name: `${step.name}圆度`,
          featureIds: [step.id],
          tolerance: 0.015,
        },
        {
          id: uid("gdt"),
          type: "position" as const,
          name: `${step.name}位置度`,
          featureIds: [step.id],
          tolerance: 0.05,
        },
      ])
      const program = {
        ...s.program,
        name: "视觉引导程序",
        steps: [...s.program.steps, ...steps],
        gdt: [...s.program.gdt, ...gdt],
      }
      persistProgram(program)
      return { program, view: "machine" as const }
    })
    get().log("info", `已将 ${hits.length} 个识别孔写入测量程序`)
  },

  exportReport: () => {
    const report = get().report
    if (!report) {
      get().log("warn", "还没有可导出的报告，请先运行测量程序")
      return
    }
    set({ view: "report" })
    requestAnimationFrame(() => window.print())
    get().log("info", "已打开打印预览，可保存为 PDF")
  },
}))

if (typeof window !== "undefined") {
  motion.subscribe((snapshot) => {
    useCmmStore.setState({ motion: snapshot })
    if (snapshot.overtravel) {
      const last = useCmmStore.getState().logs[0]
      const msg = `${snapshot.overtravel.toUpperCase()} 轴软限位触发`
      if (last?.message !== msg) useCmmStore.getState().log("warn", msg)
    }
  })
}
