"use client"

import type { MachineToolConfig } from "@/lib/coords/work-offset"
import { uid, type Axis } from "@/lib/geom"
import {
  DEFAULT_MACHINE_TOOL,
  NOMINAL_PART_ON_PALLET,
  PALLET,
  PROBE,
  nominalPartToMachine,
} from "@/lib/machine/setup"
import { applyPoint, invert, type RigidTransform } from "@/lib/math/transform"
import { HardwareMotionController } from "@/lib/motion/hardware-stub"
import { SimulatedMotionController } from "@/lib/motion/simulated-controller"
import { MotionError, type MotionSnapshot } from "@/lib/motion/types"
import { circleStep, createDemoProgram } from "@/lib/program/demo"
import {
  calibrateFromSphere,
  evaluateProgram,
  sphereTouchTargets,
  type PalletCalibration,
} from "@/lib/program/evaluate"
import { executeProgram, touchSequence, type ProbeDriver, type RunOptions } from "@/lib/program/runner"
import type {
  Evaluation,
  GdtCheck,
  LogEntry,
  LogLevel,
  MeasurementProgram,
  ProgramStep,
  ReportSnapshot,
  StepHits,
} from "@/lib/program/types"
import { createTruth, segmentClearance, simulateTouch, type SimTruth } from "@/lib/sim/world"
import { HardwareCameraDriver } from "@/lib/vision/camera"
import { detectCircles, imageDataFromUrl } from "@/lib/vision/detect"
import { createSamplePlateImage, sampleCalibration } from "@/lib/vision/sample-image"
import type { DetectedCircle } from "@/lib/vision/types"
import { create } from "zustand"

const PROGRAM_KEY = "yujian-program-v2"
const REPORT_KEY = "yujian-report-v2"
const CALIBRATION_KEY = "yujian-calibration-v1"
const MACHINE_TOOL_KEY = "yujian-machine-tool-v1"

/** program / motion 只在窄屏布局作为独立页签出现。 */
export type CenterView = "machine" | "vision" | "coords" | "nc" | "report" | "program" | "motion"
export type DroFrame = "machine" | "pallet" | "part"
export type NcMode = "offset" | "rewrite"

export const motion = new SimulatedMotionController()
export const hardwareMotion = new HardwareMotionController()
export const hardwareCamera = new HardwareCameraDriver()

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value))
}

function nowIso() {
  return new Date().toISOString()
}

type AppState = {
  motion: MotionSnapshot
  program: MeasurementProgram
  selectedStepId: string | null
  currentStepId: string | null
  running: boolean
  runLabel: string
  paused: boolean
  abortRequested: boolean
  hits: StepHits[]
  evaluation: Evaluation | null
  report: ReportSnapshot | null
  logs: LogEntry[]
  view: CenterView
  dro: DroFrame
  jogSpeed: number
  measureSpeed: number
  rapidSpeed: number
  probeSpeed: number
  calibration: PalletCalibration | null
  truth: SimTruth
  machineTool: MachineToolConfig
  ncSource: string | null
  ncMode: NcMode
  withRotation: boolean
  visionImage: string | null
  visionSize: { w: number; h: number } | null
  visionDetections: DetectedCircle[]
  visionError: string | null
  visionBusy: boolean
  hardwareNote: string
  hydrateFromStorage: () => void
  log: (level: LogLevel, message: string) => void
  setView: (view: CenterView) => void
  setDro: (frame: DroFrame) => void
  setSelectedStep: (id: string | null) => void
  setJogSpeed: (speed: number) => void
  resetDemoProgram: () => void
  addStep: (kind: ProgramStep["kind"]) => void
  removeStep: (id: string) => void
  startJog: (axis: Axis, direction: 1 | -1) => void
  stopJog: () => void
  home: () => Promise<void>
  estop: () => void
  resetEstop: () => void
  runProgram: () => Promise<void>
  calibratePallet: () => Promise<void>
  togglePause: () => void
  loadNewPart: () => void
  setMachineTool: (patch: Partial<MachineToolConfig>) => void
  setNcSource: (source: string) => void
  setNcMode: (mode: NcMode) => void
  setWithRotation: (value: boolean) => void
  loadSampleVision: () => void
  uploadVision: (file: File) => Promise<void>
  detectVision: () => Promise<void>
  applyVisionSteps: () => void
  exportReport: () => void
}

export function palletToMachineOf(s: Pick<AppState, "calibration">): RigidTransform {
  return s.calibration?.palletToMachine ?? PALLET.nominalToMachine
}

export function placementOf(s: Pick<AppState, "calibration">): RigidTransform {
  return nominalPartToMachine(palletToMachineOf(s))
}

export function tipRadiusOf(s: Pick<AppState, "calibration">): number {
  return s.calibration?.tipRadius ?? PROBE.nominalTipRadius
}

/** 当前用于显示/评价的零件坐标系：已找正用实测，否则用名义装夹。 */
export function partFrameOf(s: Pick<AppState, "calibration" | "evaluation">): RigidTransform {
  return s.evaluation?.aligned ? s.evaluation.partToMachine : placementOf(s)
}

const driver: ProbeDriver = {
  position: () => motion.getSnapshot().position,
  moveTo: (p, speed) => motion.moveTo(p, speed),
  probe: (d, maxTravel, speed) => motion.probe(d, maxTravel, speed),
}

function autoGdt(step: ProgramStep): GdtCheck[] {
  if (step.kind === "plane") {
    return [{ id: uid("gdt"), type: "flatness", name: `${step.name}平面度`, featureIds: [step.id], tolerance: 0.01 }]
  }
  if (step.kind === "line") {
    return [{ id: uid("gdt"), type: "straightness", name: `${step.name}直线度`, featureIds: [step.id], tolerance: 0.01 }]
  }
  if (step.kind === "circle") {
    return [
      { id: uid("gdt"), type: "circularity", name: `${step.name}圆度`, featureIds: [step.id], tolerance: 0.008 },
      { id: uid("gdt"), type: "position", name: `${step.name}位置度`, featureIds: [step.id], tolerance: 0.03 },
    ]
  }
  return []
}

export const useCmmStore = create<AppState>((set, get) => {
  const runOptions = (placement: RigidTransform, clearanceZ: number): RunOptions => ({
    placement,
    clearanceZ,
    tipRadius: tipRadiusOf(get()),
    retract: PROBE.retract,
    searchTravel: PROBE.searchTravel,
    rapidSpeed: get().rapidSpeed,
    measureSpeed: get().measureSpeed,
    probeSpeed: get().probeSpeed,
    checkPath: (from, to) =>
      segmentClearance(get().truth, from, to) < 0
        ? `路径 (${from.x.toFixed(1)}, ${from.y.toFixed(1)}, ${from.z.toFixed(1)}) → (${to.x.toFixed(1)}, ${to.y.toFixed(1)}, ${to.z.toFixed(1)}) 与工件或托盘干涉，已拒绝运动`
        : null,
    beforeMove: async () => {
      while (get().paused && !get().abortRequested) await new Promise((r) => setTimeout(r, 80))
      if (get().abortRequested) throw new MotionError("程序被中止", "estop")
    },
  })

  const beginRun = (label: string): boolean => {
    const s = get()
    if (s.running) return false
    if (s.motion.estop) {
      s.log("error", "急停锁定中，请先复位急停")
      return false
    }
    if (!s.motion.homed) {
      s.log("error", "未回零：上电或急停后必须先回零，才能自动运行")
      return false
    }
    set({ running: true, runLabel: label, paused: false, abortRequested: false })
    return true
  }

  const endRun = () => set({ running: false, paused: false, currentStepId: null, abortRequested: false })

  return {
    motion: motion.getSnapshot(),
    program: createDemoProgram(),
    selectedStepId: null,
    currentStepId: null,
    running: false,
    runLabel: "",
    paused: false,
    abortRequested: false,
    hits: [],
    evaluation: null,
    report: null,
    logs: [],
    view: "machine",
    dro: "machine",
    jogSpeed: 40,
    measureSpeed: 60,
    rapidSpeed: 220,
    probeSpeed: 8,
    calibration: null,
    truth: createTruth(),
    machineTool: DEFAULT_MACHINE_TOOL,
    ncSource: null,
    ncMode: "offset",
    withRotation: true,
    visionImage: null,
    visionSize: null,
    visionDetections: [],
    visionError: null,
    visionBusy: false,
    hardwareNote: hardwareCamera.isConnected() ? "相机已连接" : "工业相机未连接 · 使用示意图或上传图片",

    hydrateFromStorage: () => {
      const program = readJson<MeasurementProgram>(PROGRAM_KEY)
      const report = readJson<ReportSnapshot>(REPORT_KEY)
      const calibration = readJson<PalletCalibration>(CALIBRATION_KEY)
      const machineTool = readJson<MachineToolConfig>(MACHINE_TOOL_KEY)
      set({
        ...(program?.steps?.length ? { program } : {}),
        ...(report ? { report } : {}),
        ...(calibration ? { calibration } : {}),
        ...(machineTool ? { machineTool: { ...DEFAULT_MACHINE_TOOL, ...machineTool } } : {}),
      })
    },

    log: (level, message) =>
      set((s) => ({ logs: [{ id: uid("log"), at: nowIso(), level, message }, ...s.logs].slice(0, 120) })),

    setView: (view) => set({ view }),
    setDro: (dro) => set({ dro }),
    setSelectedStep: (id) => set({ selectedStepId: id }),
    setJogSpeed: (speed) => set({ jogSpeed: speed }),

    resetDemoProgram: () => {
      const program = createDemoProgram()
      writeJson(PROGRAM_KEY, program)
      set({ program, hits: [], evaluation: null, selectedStepId: null, currentStepId: null })
      get().log("info", `已恢复「${program.name}」`)
    },

    addStep: (kind) => {
      const s = get()
      const p = applyPoint(invert(placementOf(s)), s.motion.position)
      const count = s.program.steps.filter((st) => st.kind === kind).length + 1
      const id = uid("feat")
      let step: ProgramStep
      if (kind === "circle") {
        step = circleStep(id, `圆${count}`, { x: p.x, y: p.y, z: -4 }, 8)
      } else if (kind === "plane") {
        step = {
          id,
          kind,
          name: `平面${count}`,
          points: [
            [-15, -15],
            [15, -15],
            [15, 15],
            [-15, 15],
          ].map(([dx, dy], i) => ({
            id: `${id}-pt-${i}`,
            nominal: { x: p.x + dx, y: p.y + dy, z: 0 },
            approach: { x: 0, y: 0, z: -1 },
          })),
        }
      } else if (kind === "line") {
        step = {
          id,
          kind,
          name: `前侧边${count}`,
          points: [-30, 30].map((dx, i) => ({
            id: `${id}-pt-${i}`,
            nominal: { x: p.x + dx, y: 0, z: -8 },
            approach: { x: 0, y: 1, z: 0 },
          })),
        }
      } else {
        step = {
          id,
          kind: "point",
          name: `点${count}`,
          points: [{ id: `${id}-pt-0`, nominal: { x: p.x, y: p.y, z: 0 }, approach: { x: 0, y: 0, z: -1 } }],
        }
      }
      const program = {
        ...s.program,
        steps: [...s.program.steps, step],
        gdt: [...s.program.gdt, ...autoGdt(step)],
      }
      writeJson(PROGRAM_KEY, program)
      set({ program, selectedStepId: step.id })
      get().log("info", `已添加特征「${step.name}」（按零件坐标定义）`)
    },

    removeStep: (id) => {
      set((s) => {
        const alignment = s.program.alignment
        const usedInAlignment = alignment && Object.values(alignment).includes(id)
        const program: MeasurementProgram = {
          ...s.program,
          steps: s.program.steps.filter((step) => step.id !== id),
          gdt: s.program.gdt.filter((c) => !c.featureIds.includes(id) && !(c.datumIds ?? []).includes(id)),
          alignment: usedInAlignment ? undefined : alignment,
        }
        writeJson(PROGRAM_KEY, program)
        return { program, selectedStepId: s.selectedStepId === id ? null : s.selectedStepId }
      })
      get().log("info", "已删除特征")
    },

    startJog: (axis, direction) => {
      try {
        motion.jog(axis, direction, get().jogSpeed)
      } catch (error) {
        get().log("error", error instanceof Error ? error.message : "点动失败")
      }
    },

    stopJog: () => motion.stopJog(),

    home: async () => {
      if (get().running) return
      try {
        get().log("info", "回零：先抬 Z，再回 X/Y…")
        await motion.home(get().rapidSpeed)
        get().log("info", "已回到机械原点，允许自动运行")
      } catch (error) {
        get().log("error", error instanceof Error ? error.message : "回零失败")
      }
    },

    estop: () => {
      set({ abortRequested: true, paused: false })
      motion.estop()
      get().log("error", "急停已触发，运动已切断。复位后必须重新回零")
    },

    resetEstop: () => {
      motion.resetEstop()
      set({ abortRequested: false })
      get().log("info", "急停已复位，请回零")
    },

    togglePause: () => {
      if (!get().running) return
      set((s) => ({ paused: !s.paused }))
      get().log("warn", get().paused ? "已暂停（当前段运动完成后停止）" : "继续运行")
    },

    calibratePallet: async () => {
      if (!beginRun("标定")) return
      const sphere = PALLET.referenceSphere
      const nominalCenter = applyPoint(PALLET.nominalToMachine, sphere.center)
      get().log("info", `标准球标定：Ø${(sphere.radius * 2).toFixed(4)} mm，共 9 点`)
      try {
        const opts = {
          ...runOptions(PALLET.nominalToMachine, nominalCenter.z + 30),
          tipRadius: PROBE.nominalTipRadius,
        }
        const { hits, missed } = await touchSequence(driver, sphereTouchTargets(nominalCenter, sphere.radius), opts, false)
        if (missed.length) throw new Error(`${missed.length} 个标定点未触发，请检查标准球是否装好`)
        const cur = motion.getSnapshot().position
        await motion.moveTo({ ...cur, z: nominalCenter.z + 30 }, get().rapidSpeed)
        const calibration = calibrateFromSphere(
          hits.map((h) => h.center),
          sphere.radius,
          sphere.center,
          PALLET.nominalToMachine
        )
        writeJson(CALIBRATION_KEY, calibration)
        set({ calibration, evaluation: null })
        const d = calibration.shift
        get().log(
          "info",
          `标定完成：测针有效半径 ${calibration.tipRadius.toFixed(4)} mm，托盘零点偏移 (${d.x.toFixed(4)}, ${d.y.toFixed(4)}, ${d.z.toFixed(4)})，球形误差 ${(calibration.sphereForm * 1000).toFixed(1)} μm`
        )
      } catch (error) {
        get().log("error", error instanceof Error ? error.message : "标定失败")
      } finally {
        endRun()
      }
    },

    runProgram: async () => {
      const { program } = get()
      if (!program.steps.length) {
        get().log("warn", "程序为空，请先加载示例或添加特征")
        return
      }
      if (!beginRun("测量")) return
      if (!get().calibration) get().log("warn", "托盘零点和测针未标定，按设计值计算，精度不可信")
      const placement = placementOf(get())
      const clearanceZ = applyPoint(placement, { x: 0, y: 0, z: 0 }).z + PROBE.clearanceAbovePart
      set({ hits: [], evaluation: null, currentStepId: program.steps[0]?.id ?? null })
      get().log("info", `开始运行「${program.name}」`)
      try {
        const hits = await executeProgram(program, driver, {
          ...runOptions(placement, clearanceZ),
          onStep: (stepId) => {
            const step = program.steps.find((st) => st.id === stepId)
            set((s) => ({ currentStepId: stepId, selectedStepId: stepId, hits: [...s.hits, { stepId, hits: [] }] }))
            if (step) get().log("info", `测量 ${step.name}`)
          },
          onHit: (stepId, hit) =>
            set((s) => ({
              hits: s.hits.map((h) => (h.stepId === stepId ? { ...h, hits: [...h.hits, hit] } : h)),
            })),
        })
        hits.filter((h) => h.error).forEach((h) => {
          const name = program.steps.find((st) => st.id === h.stepId)?.name ?? h.stepId
          get().log("warn", `${name}：${h.error}，该特征跳过`)
        })
        const evaluation = evaluateProgram(program, hits, {
          tipRadius: tipRadiusOf(get()),
          palletToMachine: palletToMachineOf(get()),
          nominalPartToPallet: NOMINAL_PART_ON_PALLET,
          placement,
        })
        const report: ReportSnapshot = {
          createdAt: nowIso(),
          programName: program.name,
          features: evaluation.features,
          gdt: evaluation.gdt,
          aligned: evaluation.aligned,
          alignmentNote: evaluation.alignmentNote,
          palletDelta: evaluation.pallet.delta,
          tiltWarning: evaluation.pallet.tiltWarning,
          tipRadius: evaluation.tipRadius,
          calibrated: Boolean(get().calibration),
        }
        writeJson(REPORT_KEY, report)
        set({ hits, evaluation, report })
        const d = evaluation.pallet.delta
        get().log(
          "info",
          `测量完成。零件相对零点托盘偏差 X ${d.x.toFixed(4)} Y ${d.y.toFixed(4)} Z ${d.z.toFixed(4)} mm，旋转 ${d.rz.toFixed(4)}°`
        )
        if (evaluation.pallet.tiltWarning) get().log("warn", evaluation.pallet.tiltWarning)
        const failed = evaluation.gdt.filter((g) => !g.passed).length
        if (failed) get().log("warn", `${failed} 项形位公差超差或无法评价`)
      } catch (error) {
        get().log("error", error instanceof Error ? error.message : "运行失败")
      } finally {
        endRun()
      }
    },

    loadNewPart: () => {
      if (get().running) return
      const old = get().truth
      const truth = { ...createTruth(), palletToMachine: old.palletToMachine, tipRadius: old.tipRadius }
      set({ truth, hits: [], evaluation: null })
      get().log("info", "已装上新零件（仿真随机装夹偏差，软件事先不知道），请重新运行预检程序")
    },

    setMachineTool: (patch) => {
      const machineTool = { ...get().machineTool, ...patch }
      writeJson(MACHINE_TOOL_KEY, machineTool)
      set({ machineTool })
    },

    setNcSource: (ncSource) => set({ ncSource }),
    setNcMode: (ncMode) => set({ ncMode }),
    setWithRotation: (withRotation) => set({ withRotation }),

    loadSampleVision: () => {
      const url = createSamplePlateImage()
      set({ visionImage: url, visionSize: { w: 480, h: 336 }, visionDetections: [], visionError: null, view: "vision" })
      get().log("info", "已加载示例工件图（非工业相机）")
    },

    uploadVision: async (file) => {
      const url = URL.createObjectURL(file)
      set({ visionImage: url, visionSize: null, visionDetections: [], visionError: null, view: "vision" })
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
        set({ visionSize: { w: image.width, h: image.height } })
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
          set({ visionDetections: [], visionError: "未识别到圆孔。请使用对比清晰的俯视工件图，或先加载示例图。" })
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
        const steps = hits.map((hit, index) =>
          circleStep(uid("feat"), `视觉孔${index + 1}`, { x: hit.x, y: hit.y, z: -4 }, Math.round(hit.radius * 2) / 2)
        )
        const program = {
          ...s.program,
          steps: [...s.program.steps, ...steps],
          gdt: [...s.program.gdt, ...steps.flatMap(autoGdt)],
        }
        writeJson(PROGRAM_KEY, program)
        return { program, view: "machine" as const }
      })
      get().log("info", `已将 ${hits.length} 个识别孔写入测量程序（视觉只做粗定位，精确值由测头测量）`)
    },

    exportReport: () => {
      if (!get().report) {
        get().log("warn", "还没有可导出的报告，请先运行预检程序")
        return
      }
      set({ view: "report" })
      requestAnimationFrame(() => window.print())
      get().log("info", "已打开打印预览，可保存为 PDF")
    },
  }
})

if (typeof window !== "undefined") {
  motion.setTouchSensor((start, direction, maxTravel) =>
    simulateTouch(useCmmStore.getState().truth, start, direction, maxTravel)
  )
  motion.subscribe((snapshot) => {
    const prev = useCmmStore.getState().motion
    useCmmStore.setState({ motion: snapshot })
    if (snapshot.overtravel && snapshot.overtravel !== prev.overtravel) {
      useCmmStore.getState().log("warn", `${snapshot.overtravel.toUpperCase()} 轴软限位触发`)
    }
  })
}