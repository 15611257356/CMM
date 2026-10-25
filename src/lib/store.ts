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
import { MaccBridgeController } from "@/lib/macc/controller"
import { MACC_TEMP_PAIRING } from "@/lib/macc/errors"
import { DEFAULT_MACC_BRIDGE, emptyTelemetry, type MaccTelemetry } from "@/lib/macc/protocol"
import { setupToolSummary, type SetupToolProfile } from "@/lib/macc/setuptool"
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
import { exportSuperDmis as buildSuperDmis, superDmisSafeName } from "@/lib/super-dmis/dmis"
import { emptyGeom21, geom21IsIdentity, type Geom21 } from "@/lib/super-dmis/geom21"
import { compensateImport, detectAndParse } from "@/lib/super-dmis/import-file"
import type { StepGaugeTruth } from "@/lib/super-dmis/parse-dat"
import { matchImportedHits, programFromImport } from "@/lib/super-dmis/parse-hits"
import { tableSummary } from "@/lib/super-dmis/parse-nonlinear"
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
const GEOM21_KEY = "yujian-geom21-v1"

/** program / motion 只在窄屏布局作为独立页签出现。 */
export type CenterView = "machine" | "vision" | "coords" | "nc" | "report" | "program" | "motion"
export type DroFrame = "machine" | "pallet" | "part"
export type NcMode = "offset" | "rewrite"

export const motion = new SimulatedMotionController()
export const hardwareMotion = new MaccBridgeController()
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
  geom21: Geom21
  applyGeomOnImport: boolean
  stepGauge: StepGaugeTruth | null
  macc: MaccTelemetry
  driveHardware: boolean
  maccBusy: boolean
  setupTool: SetupToolProfile | null
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
  exportSuperDmis: () => void
  importExternalFile: (file: File) => Promise<void>
  setApplyGeomOnImport: (value: boolean) => void
  setGeom21: (patch: Partial<Geom21>) => void
  clearGeom21: () => void
  connectMacc: (url?: string) => Promise<void>
  disconnectMacc: () => void
  setDriveHardware: (value: boolean) => void
  setMaccTemperatureComp: (value: boolean) => Promise<void>
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
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

const liveMotion = () => {
  const s = useCmmStore.getState()
  return s.driveHardware && s.macc.connected ? hardwareMotion : motion
}

const driver: ProbeDriver = {
  position: () => liveMotion().getSnapshot().position,
  moveTo: (p, speed) => liveMotion().moveTo(p, speed),
  probe: (d, maxTravel, speed) => liveMotion().probe(d, maxTravel, speed),
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
    retract: get().setupTool?.retractMm ?? PROBE.retract,
    searchTravel: get().setupTool?.searchMm ?? PROBE.searchTravel,
    rapidSpeed: get().rapidSpeed,
    measureSpeed: get().measureSpeed,
    probeSpeed: get().probeSpeed,
    checkPath: (from, to) => {
      if (get().driveHardware && get().macc.connected) return null
      return segmentClearance(get().truth, from, to) < 0
        ? `路径 (${from.x.toFixed(1)}, ${from.y.toFixed(1)}, ${from.z.toFixed(1)}) → (${to.x.toFixed(1)}, ${to.y.toFixed(1)}, ${to.z.toFixed(1)}) 与工件或托盘干涉，已拒绝运动`
        : null
    },
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
    geom21: emptyGeom21(),
    applyGeomOnImport: false,
    stepGauge: null,
    macc: emptyTelemetry(),
    driveHardware: false,
    maccBusy: false,
    setupTool: null,

    hydrateFromStorage: () => {
      const program = readJson<MeasurementProgram>(PROGRAM_KEY)
      const report = readJson<ReportSnapshot>(REPORT_KEY)
      const calibration = readJson<PalletCalibration>(CALIBRATION_KEY)
      const machineTool = readJson<MachineToolConfig>(MACHINE_TOOL_KEY)
      const geom21 = readJson<Geom21>(GEOM21_KEY)
      set({
        ...(program?.steps?.length ? { program } : {}),
        ...(report ? { report } : {}),
        ...(calibration ? { calibration } : {}),
        ...(machineTool ? { machineTool: { ...DEFAULT_MACHINE_TOOL, ...machineTool } } : {}),
        ...(geom21 ? { geom21: { ...emptyGeom21(), ...geom21 } } : {}),
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
        liveMotion().jog(axis, direction, get().jogSpeed)
      } catch (error) {
        get().log("error", error instanceof Error ? error.message : "点动失败")
      }
    },

    stopJog: () => liveMotion().stopJog(),

    home: async () => {
      if (get().running) return
      try {
        get().log("info", "回零：先抬 Z，再回 X/Y…")
        await liveMotion().home(get().rapidSpeed)
        get().log("info", "已回到机械原点，允许自动运行")
      } catch (error) {
        get().log("error", error instanceof Error ? error.message : "回零失败")
      }
    },

    estop: () => {
      set({ abortRequested: true, paused: false })
      liveMotion().estop()
      get().log("error", "急停已触发，运动已切断。复位后必须重新回零")
    },

    resetEstop: () => {
      liveMotion().resetEstop()
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

    exportSuperDmis: () => {
      const program = get().program
      if (!program.steps.length) {
        get().log("warn", "程序为空，无法导出 DMIS")
        return
      }
      const text = buildSuperDmis(program)
      const filename = superDmisSafeName(program.id || program.name)
      downloadText(filename, text)
      get().log(
        "info",
        `已导出 SuperDMIS 程序 ${filename}。安装路径只能用英文、数字、-、_，不要放到带中文或空格的目录，否则 SuperDMIS 会无法保存/导出报告`
      )
    },

    setApplyGeomOnImport: (applyGeomOnImport) => set({ applyGeomOnImport }),

    setGeom21: (patch) => {
      const geom21 = { ...get().geom21, ...patch }
      writeJson(GEOM21_KEY, geom21)
      set({ geom21 })
    },

    clearGeom21: () => {
      const geom21 = emptyGeom21()
      writeJson(GEOM21_KEY, geom21)
      set({ geom21, stepGauge: null })
      get().log("info", "已清除 X-Inspect 几何补偿表")
    },

    importExternalFile: async (file) => {
      let text: string
      try {
        text = await file.text()
      } catch {
        get().log("error", `无法读取 ${file.name}`)
        return
      }
      try {
        const detected = detectAndParse(text, file.name)
        if (detected.kind === "setuptool") {
          const setupTool = detected.data
          hardwareMotion.setMeasureParams({ retractMm: setupTool.retractMm, retractSpeed: setupTool.retractSpeed })
          set({
            setupTool,
            probeSpeed: setupTool.measureSpeed,
            measureSpeed: setupTool.positionSpeed,
            rapidSpeed: setupTool.positionSpeed,
          })
          get().log(
            "info",
            `已导入 SetupTool ${setupToolSummary(setupTool)}。工控机桥接连控制器时用该 IP/端口。温度通道 ${setupTool.temperatureChannels.filter((c) => c).length}/16 已映射`
          )
          return
        }
        if (detected.kind === "step-gauge") {
          set({ stepGauge: detected.data })
          get().log(
            "info",
            `已导入步距规真值 ${file.name}，${detected.data.segments.length} 段。这是 X-Inspect 校准用的证书数据，不是零件测点`
          )
          return
        }
        if (detected.kind === "nonlinear") {
          writeJson(GEOM21_KEY, detected.data)
          set({ geom21: detected.data, applyGeomOnImport: true })
          get().log(
            "info",
            `已导入 X-Inspect 非线性补偿 ${file.name}：X ${tableSummary(detected.data.x)}，Y ${tableSummary(detected.data.y)}，Z ${tableSummary(detected.data.z)}。导入测点时可勾选施加补偿`
          )
          return
        }
        const geom = get().geom21
        const shouldComp = get().applyGeomOnImport && !geom21IsIdentity(geom)
        const data = compensateImport(detected.data, geom, shouldComp)
        let program = get().program
        let hits = program.steps.length ? matchImportedHits(program, data.features) : []
        const matched = hits.filter((h) => h.hits.length).length
        if (!program.steps.length || matched === 0) {
          program = programFromImport(data.features, file.name.replace(/\.[^.]+$/, "") || "SuperDMIS 导入")
          writeJson(PROGRAM_KEY, program)
          hits = matchImportedHits(program, data.features)
        }
        const evaluation = evaluateProgram(program, hits, {
          tipRadius: tipRadiusOf(get()),
          palletToMachine: palletToMachineOf(get()),
          nominalPartToPallet: NOMINAL_PART_ON_PALLET,
          placement: placementOf(get()),
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
        set({ program, hits, evaluation, report, view: "coords", selectedStepId: program.steps[0]?.id ?? null })
        const d = evaluation.pallet.delta
        get().log(
          "info",
          `已导入 ${file.name}（${data.format}${shouldComp ? "，已施加 21 项补偿" : ""}），${data.features.length} 个特征。${
            evaluation.aligned
              ? `已 3-2-1 找正，零件相对托盘偏差 X ${d.x.toFixed(4)} Y ${d.y.toFixed(4)} Z ${d.z.toFixed(4)} mm，旋转 ${d.rz.toFixed(4)}°`
              : evaluation.alignmentNote
          }`
        )
      } catch (error) {
        get().log("error", error instanceof Error ? error.message : "导入失败")
      }
    },

    connectMacc: async (url = DEFAULT_MACC_BRIDGE) => {
      set({ maccBusy: true, macc: { ...get().macc, bridgeUrl: url } })
      try {
        await hardwareMotion.connect(url)
        set({ macc: hardwareMotion.getTelemetry() })
        get().log("info", `已连接 MACC 桥接 ${url}。序列号 ${hardwareMotion.getTelemetry().serial || "—"}`)
      } catch (error) {
        set({ driveHardware: false, macc: hardwareMotion.getTelemetry() })
        get().log("error", error instanceof Error ? error.message : "连接 MACC 失败")
      } finally {
        set({ maccBusy: false })
      }
    },

    disconnectMacc: () => {
      hardwareMotion.disconnect()
      set({ driveHardware: false, macc: emptyTelemetry(get().macc.bridgeUrl) })
      get().log("info", "已断开 MACC")
    },

    setDriveHardware: (driveHardware) => {
      if (driveHardware && !get().macc.connected) {
        get().log("warn", "还没有连上 MACC 桥接，不能把点动/自动运行切到真机")
        return
      }
      set({ driveHardware })
      get().log(
        driveHardware ? "warn" : "info",
        driveHardware
          ? "真机运动已打开：点动、回零和预检程序走 MACC。急停仍应走硬件回路。"
          : "已回到仿真控制器"
      )
    },

    setMaccTemperatureComp: async (value) => {
      try {
        await hardwareMotion.setTemperatureCompensation(value)
        set({ macc: hardwareMotion.getTelemetry() })
        get().log(value ? "warn" : "info", value ? MACC_TEMP_PAIRING.note : "已关闭控制器温度补偿")
      } catch (error) {
        get().log("error", error instanceof Error ? error.message : "温度补偿设置失败")
      }
    },
  }
})

if (typeof window !== "undefined") {
  motion.setTouchSensor((start, direction, maxTravel) =>
    simulateTouch(useCmmStore.getState().truth, start, direction, maxTravel)
  )
  motion.subscribe((snapshot) => {
    const s = useCmmStore.getState()
    if (s.driveHardware && s.macc.connected) return
    const prev = s.motion
    useCmmStore.setState({ motion: snapshot })
    if (snapshot.overtravel && snapshot.overtravel !== prev.overtravel) {
      useCmmStore.getState().log("warn", `${snapshot.overtravel.toUpperCase()} 轴软限位触发`)
    }
  })
  hardwareMotion.subscribe((snapshot) => {
    const s = useCmmStore.getState()
    if (!(s.driveHardware && s.macc.connected)) return
    useCmmStore.setState({ motion: snapshot })
  })
  hardwareMotion.subscribeTelemetry((macc) => {
    useCmmStore.setState({ macc })
  })
}