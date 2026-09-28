"use client"

import { workOffsetFromPose, type MachineToolConfig } from "@/lib/coords/work-offset"
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
import { autoProgram, type PartModel } from "@/lib/program/auto"
import { circleStep, createDemoProgram, PLATE_MODEL } from "@/lib/program/demo"
import { exportDmis } from "@/lib/program/dmis"
import { renameProgram, renameStep, setAlignmentRole, setCircleSpec, setGdtTolerance, setPointCount } from "@/lib/program/edit"
import { applyDialYaw, indicateEdge, type IndicatorReading, type IndicatorResult } from "@/lib/program/indicator"
import {
  calibrateFromSphere,
  checkFixedFrame,
  evaluateProgram,
  type FixedFrameCheck,
  type PalletCalibration,
} from "@/lib/program/evaluate"
import { executeProgram, touchSphereSection, type ProbeDriver, type RunOptions } from "@/lib/program/runner"
import { appliedThermal, DEFAULT_THERMAL, type ThermalSettings } from "@/lib/measure/thermal"
import type {
  AlignmentDef,
  Evaluation,
  GdtCheck,
  InspectMode,
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
const PREFS_KEY = "yujian-prefs-v1"

type Prefs = {
  inspectMode: InspectMode
  partSerial: string
  thermal: ThermalSettings
  useDialYaw: boolean
}

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
  frameCheck: FixedFrameCheck | null
  truth: SimTruth
  machineTool: MachineToolConfig
  ncSource: string | null
  ncMode: NcMode
  withRotation: boolean
  inspectMode: InspectMode
  partSerial: string
  thermal: ThermalSettings
  dialReadings: IndicatorReading[]
  dialResult: IndicatorResult | null
  dialInputMm: number
  useDialYaw: boolean
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
  loadTemplate: (which: "preset" | "post" | "demo") => void
  renameCurrentProgram: (name: string) => void
  renameSelectedStep: (name: string) => void
  setStepPointCount: (id: string, count: number) => void
  setStepCircle: (id: string, spec: { diameter?: number; sizeTolerance?: number | null }) => void
  setAlignment: (role: keyof AlignmentDef, stepId: string | null) => void
  setTolerance: (checkId: string, tolerance: number) => void
  setInspectMode: (mode: InspectMode) => void
  setPartSerial: (serial: string) => void
  setThermal: (patch: Partial<ThermalSettings>) => void
  setDialInput: (mm: number) => void
  recordDial: () => void
  clearDial: () => void
  setUseDialYaw: (value: boolean) => void
  addStep: (kind: ProgramStep["kind"]) => void
  removeStep: (id: string) => void
  startJog: (axis: Axis, direction: 1 | -1) => void
  stopJog: () => void
  home: () => Promise<void>
  estop: () => void
  resetEstop: () => void
  runProgram: () => Promise<void>
  calibratePallet: () => Promise<void>
  verifyFixedFrame: () => Promise<void>
  autoPreset: () => Promise<void>
  exportProgramDmis: () => void
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

/** 自动编程用的零件模型：视觉识别到孔时用视觉孔位，否则用示例底板。 */
export function partModelOf(s: Pick<AppState, "visionDetections">): PartModel {
  if (!s.visionDetections.length) return PLATE_MODEL
  return {
    ...PLATE_MODEL,
    holes: s.visionDetections.map((d, i) => ({
      id: String.fromCharCode(65 + i),
      name: `孔${String.fromCharCode(65 + i)}`,
      x: d.x,
      y: d.y,
      r: Math.round(d.radius * 2) / 2,
    })),
  }
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
    frameCheck: null,
    truth: createTruth(),
    machineTool: DEFAULT_MACHINE_TOOL,
    ncSource: null,
    ncMode: "offset",
    withRotation: true,
    inspectMode: "preset",
    partSerial: "",
    thermal: DEFAULT_THERMAL,
    dialReadings: [],
    dialResult: null,
    dialInputMm: 0,
    useDialYaw: false,
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
      const prefs = readJson<Partial<Prefs>>(PREFS_KEY)
      const normalized = report
        ? {
            ...report,
            mode: report.mode ?? "preset",
            reportNo: report.reportNo ?? "",
            partSerial: report.partSerial ?? "",
            thermal: report.thermal ?? null,
          }
        : null
      set({
        ...(program?.steps?.length ? { program } : {}),
        ...(normalized ? { report: normalized } : {}),
        ...(calibration ? { calibration } : {}),
        ...(machineTool ? { machineTool: { ...DEFAULT_MACHINE_TOOL, ...machineTool } } : {}),
        ...(prefs?.inspectMode ? { inspectMode: prefs.inspectMode } : {}),
        ...(prefs?.partSerial !== undefined ? { partSerial: prefs.partSerial } : {}),
        ...(prefs?.thermal ? { thermal: { ...DEFAULT_THERMAL, ...prefs.thermal } } : {}),
        ...(prefs?.useDialYaw !== undefined ? { useDialYaw: prefs.useDialYaw } : {}),
      })
    },

    log: (level, message) =>
      set((s) => ({ logs: [{ id: uid("log"), at: nowIso(), level, message }, ...s.logs].slice(0, 120) })),

    setView: (view) => set({ view }),
    setDro: (dro) => set({ dro }),
    setSelectedStep: (id) => set({ selectedStepId: id }),
    setJogSpeed: (speed) => set({ jogSpeed: speed }),

    resetDemoProgram: () => get().loadTemplate("demo"),

    loadTemplate: (which) => {
      const part = partModelOf(get())
      const program = which === "demo" ? createDemoProgram() : autoProgram(part, which)
      const inspectMode: InspectMode = which === "demo" ? get().inspectMode : which
      writeJson(PROGRAM_KEY, program)
      const prefs: Prefs = {
        inspectMode,
        partSerial: get().partSerial,
        thermal: get().thermal,
        useDialYaw: get().useDialYaw,
      }
      writeJson(PREFS_KEY, prefs)
      set({ program, inspectMode, hits: [], evaluation: null, selectedStepId: null, currentStepId: null })
      const points = program.steps.reduce((n, step) => n + step.points.length, 0)
      get().log(
        "info",
        which === "demo"
          ? `已载入「${program.name}」`
          : `自动编程：「${program.name}」${program.steps.length} 个特征、${points} 个触测点${part.holes !== PLATE_MODEL.holes ? "（孔位取自视觉识别）" : ""}`
      )
    },

    renameCurrentProgram: (name) => {
      const program = renameProgram(get().program, name)
      writeJson(PROGRAM_KEY, program)
      set({ program })
    },

    renameSelectedStep: (name) => {
      const id = get().selectedStepId
      if (!id) return
      const program = renameStep(get().program, id, name)
      writeJson(PROGRAM_KEY, program)
      set({ program })
    },

    setStepPointCount: (id, count) => {
      const program = setPointCount(get().program, id, count)
      writeJson(PROGRAM_KEY, program)
      set({ program })
    },

    setStepCircle: (id, spec) => {
      const program = setCircleSpec(get().program, id, spec)
      writeJson(PROGRAM_KEY, program)
      set({ program })
    },

    setAlignment: (role, stepId) => {
      const result = setAlignmentRole(get().program, role, stepId)
      writeJson(PROGRAM_KEY, result.program)
      set({ program: result.program })
      if (result.error) get().log("warn", result.error)
      else if (result.program.alignment) get().log("info", "3-2-1 找正基准已更新")
    },

    setTolerance: (checkId, tolerance) => {
      const program = setGdtTolerance(get().program, checkId, tolerance)
      writeJson(PROGRAM_KEY, program)
      set({ program })
    },

    setInspectMode: (inspectMode) => {
      const prefs: Prefs = {
        inspectMode,
        partSerial: get().partSerial,
        thermal: get().thermal,
        useDialYaw: get().useDialYaw,
      }
      writeJson(PREFS_KEY, prefs)
      set({ inspectMode })
    },

    setPartSerial: (partSerial) => {
      writeJson(PREFS_KEY, {
        inspectMode: get().inspectMode,
        partSerial,
        thermal: get().thermal,
        useDialYaw: get().useDialYaw,
      } satisfies Prefs)
      set({ partSerial })
    },

    setThermal: (patch) => {
      const thermal = { ...get().thermal, ...patch }
      if (patch.material) thermal.material = patch.material
      writeJson(PREFS_KEY, {
        inspectMode: get().inspectMode,
        partSerial: get().partSerial,
        thermal,
        useDialYaw: get().useDialYaw,
      } satisfies Prefs)
      set({ thermal })
    },

    setDialInput: (dialInputMm) => set({ dialInputMm }),

    recordDial: () => {
      const readings = [
        ...get().dialReadings,
        { position: { ...get().motion.position }, readingMm: get().dialInputMm },
      ]
      const dialResult = indicateEdge(readings)
      set({ dialReadings: readings, dialResult })
      if (!dialResult) get().log("warn", readings.length < 2 ? "再记一个点才能算转角" : "行程不足 5 mm，继续沿边移动后再记")
      else
        get().log(
          "info",
          `千分表：沿 ${dialResult.travel.toUpperCase()} ${dialResult.spanMm.toFixed(1)} mm，转角 ${dialResult.angleDeg.toFixed(4)}°，直线变动 ${(dialResult.variationMm * 1000).toFixed(1)} μm`
        )
    },

    clearDial: () => {
      set({ dialReadings: [], dialResult: null })
      get().log("info", "已清除千分表读数")
    },

    setUseDialYaw: (useDialYaw) => {
      writeJson(PREFS_KEY, {
        inspectMode: get().inspectMode,
        partSerial: get().partSerial,
        thermal: get().thermal,
        useDialYaw,
      } satisfies Prefs)
      set({ useDialYaw })
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
      if (!beginRun("建固定坐标系")) return
      const sphere = PALLET.referenceSphere
      const nominalCenter = applyPoint(PALLET.nominalToMachine, sphere.center)
      get().log("info", `建立固定坐标系：测 Ø${(sphere.radius * 2).toFixed(4)} mm 标准球，截面 4 点 + 顶点`)
      try {
        const opts = {
          ...runOptions(PALLET.nominalToMachine, nominalCenter.z + 30),
          tipRadius: PROBE.nominalTipRadius,
        }
        const { hits, missed } = await touchSphereSection(driver, nominalCenter, sphere.radius, opts)
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
        set({ calibration, frameCheck: null, evaluation: null })
        const d = calibration.shift
        get().log(
          "info",
          `固定坐标系已建立：测针有效半径 ${calibration.tipRadius.toFixed(4)} mm，托盘零点偏移 (${d.x.toFixed(4)}, ${d.y.toFixed(4)}, ${d.z.toFixed(4)})，球形误差 ${(calibration.sphereForm * 1000).toFixed(1)} μm`
        )
      } catch (error) {
        get().log("error", error instanceof Error ? error.message : "建立固定坐标系失败")
      } finally {
        endRun()
      }
    },

    verifyFixedFrame: async () => {
      const calibration = get().calibration
      if (!calibration) {
        get().log("error", "还没有固定坐标系，请先建立")
        return
      }
      if (!beginRun("复核")) return
      const sphere = PALLET.referenceSphere
      const expected = applyPoint(calibration.palletToMachine, sphere.center)
      try {
        const opts = { ...runOptions(calibration.palletToMachine, expected.z + 30), tipRadius: calibration.tipRadius }
        const { hits, missed } = await touchSphereSection(driver, expected, sphere.radius, opts)
        if (missed.length) throw new Error(`${missed.length} 个复核点未触发`)
        const cur = motion.getSnapshot().position
        await motion.moveTo({ ...cur, z: expected.z + 30 }, get().rapidSpeed)
        const frameCheck = checkFixedFrame(
          hits.map((h) => h.center),
          calibration,
          sphere.center
        )
        set({ frameCheck })
        get().log(
          frameCheck.ok ? "info" : "warn",
          frameCheck.ok
            ? `固定坐标系复核通过：漂移 ${(frameCheck.driftMm * 1000).toFixed(1)} μm`
            : `固定坐标系漂移 ${(frameCheck.driftMm * 1000).toFixed(1)} μm，超过 2 μm，请重新建立`
        )
      } catch (error) {
        get().log("error", error instanceof Error ? error.message : "复核失败")
      } finally {
        endRun()
      }
    },

    autoPreset: async () => {
      if (get().running) return
      if (!get().motion.homed) {
        get().log("error", "未回零：先回零，再一键预调")
        return
      }
      get().log("info", "一键预调：固定坐标系 → 自动编程 → 自动测量 → 自动找正 → 工件坐标系")
      if (!get().calibration) {
        await get().calibratePallet()
        if (!get().calibration) return
      }
      get().loadTemplate("preset")
      await get().runProgram()
      const evaluation = get().evaluation
      const offset = get().report?.workOffset
      if (evaluation?.aligned && offset) {
        get().log(
          "info",
          `一键预调完成：${offset.register} X ${offset.x.toFixed(4)} Y ${offset.y.toFixed(4)} Z ${offset.z.toFixed(4)}，绕 Z ${offset.rotationDeg.toFixed(4)}°`
        )
        set({ view: "coords" })
      }
    },

    exportProgramDmis: () => {
      const program = get().program
      const text = exportDmis(program)
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${program.id}.dms`
      a.click()
      URL.revokeObjectURL(url)
      get().log("info", `已导出 DMIS 程序 ${program.id}.dms，可在现成三坐标软件中执行采点`)
    },

    runProgram: async () => {
      const { program } = get()
      if (!program.steps.length) {
        get().log("warn", "程序为空，请先自动编程或添加特征")
        return
      }
      if (!get().calibration) {
        get().log("error", "还没有固定坐标系：先测标准球建立本机固定坐标系，再测量找正")
        return
      }
      const inspectMode = get().inspectMode
      if (!beginRun(inspectMode === "post" ? "复测" : "预调")) return
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
        const thermal = appliedThermal(get().thermal)
        const evaluation = evaluateProgram(program, hits, {
          tipRadius: tipRadiusOf(get()),
          palletToMachine: palletToMachineOf(get()),
          nominalPartToPallet: NOMINAL_PART_ON_PALLET,
          placement,
          thermal,
        })
        const pose = applyDialYaw(evaluation.pallet.actual, get().dialResult, get().useDialYaw)
        const report: ReportSnapshot = {
          mode: inspectMode,
          reportNo: `YJ-${inspectMode === "post" ? "R" : "P"}-${Date.now().toString(36).toUpperCase()}`,
          partSerial: get().partSerial,
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
          thermal,
          workOffset: workOffsetFromPose(pose, get().machineTool),
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