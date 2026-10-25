"use client"

import { workOffsetFromPose, type MachineToolConfig } from "@/lib/coords/work-offset"
import { uid, type Axis, type Vec3 } from "@/lib/geom"
import { DEFAULT_IPP_RELAY, IppMotionController, type IppStatus } from "@/lib/ipp/controller"
import { createModelDistance, type ModelDistance } from "@/lib/model/distance"
import { parseModelBuffer } from "@/lib/model/load"
import { triNormalArea } from "@/lib/model/mesh"
import { clearModelFile, loadModelFile, saveModelFile } from "@/lib/model/persist"
import { modelBoundsIn, modelOnPallet } from "@/lib/model/placement"
import { analyzeFace, completeManualStep, FACE_KIND_LABEL, featureFromFace, singlePointStep } from "@/lib/model/recognize"
import type { FaceInfo, ModelOrientation, PartModel } from "@/lib/model/types"
import {
  DEFAULT_MACHINE_TOOL,
  NOMINAL_PART_ON_PALLET,
  PALLET,
  PROBE,
  nominalPartToMachine,
  probeTravelsForRun,
} from "@/lib/machine/setup"
import { applyPoint, invert, type RigidTransform } from "@/lib/math/transform"
import { MaccBridgeController } from "@/lib/macc/controller"
import { MACC_TEMP_PAIRING } from "@/lib/macc/errors"
import { DEFAULT_MACC_BRIDGE, emptyTelemetry, type MaccTelemetry } from "@/lib/macc/protocol"
import { setupToolSummary, type SetupToolProfile } from "@/lib/macc/setuptool"
import { SimulatedMotionController } from "@/lib/motion/simulated-controller"
import { MotionError, type MotionSnapshot } from "@/lib/motion/types"
import { appliedThermal, DEFAULT_THERMAL, type ThermalSettings } from "@/lib/measure/thermal"
import { autoProgram, type PartModel as PlatePart } from "@/lib/program/auto"
import { circleStep, createDemoProgram, KIND_LABEL as KIND_NAME, PLATE_MODEL } from "@/lib/program/demo"
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
import {
  executeProgram,
  planProgram,
  touchSphereSection,
  type ProbeDriver,
  type ProgramPlan,
  type RunOptions,
} from "@/lib/program/runner"
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
import { exportSuperDmis as buildSuperDmis, superDmisSafeName } from "@/lib/super-dmis/dmis"
import { emptyGeom21, geom21IsIdentity, type Geom21 } from "@/lib/super-dmis/geom21"
import { compensateImport, detectAndParse } from "@/lib/super-dmis/import-file"
import type { StepGaugeTruth } from "@/lib/super-dmis/parse-dat"
import { matchImportedHits, programFromImport } from "@/lib/super-dmis/parse-hits"
import { tableSummary } from "@/lib/super-dmis/parse-nonlinear"
import { publicUrl } from "@/lib/public-url"
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
const GEOM21_KEY = "yujian-geom21-v1"
const ORIENTATION_KEY = "yujian-model-orientation-v1"
const IPP_KEY = "yujian-ipp-v1"

export const SAMPLE_MODEL_URL = publicUrl("/samples/locating-block-lb02.step")

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
/** face：点面自动生成特征；line：点侧面生成直线；point：单点；circle/plane：逐点手动拾取。 */
export type PickMode = "off" | "face" | "line" | "point" | "circle" | "plane"
export type HardwareChannel = "macc" | "ipp"

export type PickedPoint = { nominal: Vec3; normal: Vec3; face: number }

export const motion = new SimulatedMotionController()
export const hardwareMotion = new MaccBridgeController()
export const ippMotion = new IppMotionController()
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
  geom21: Geom21
  applyGeomOnImport: boolean
  stepGauge: StepGaugeTruth | null
  macc: MaccTelemetry
  driveHardware: boolean
  maccBusy: boolean
  setupTool: SetupToolProfile | null
  model: PartModel | null
  modelDistance: ModelDistance | null
  modelOrientation: ModelOrientation
  nominalOnPallet: RigidTransform
  modelBusy: boolean
  pickMode: PickMode
  hoverFace: number | null
  pickedFace: FaceInfo | null
  manualPoints: PickedPoint[]
  plan: ProgramPlan | null
  planBusy: boolean
  hardwareChannel: HardwareChannel
  ipp: IppStatus
  ippBusy: boolean
  /** IPPServer 的 PtMeas 回的是已补偿测针半径的表面点（默认）；关掉则当作球心。 */
  ippSurfacePoint: boolean
  hydrateFromStorage: () => void
  importModel: (file: File) => Promise<void>
  loadSampleModel: () => Promise<void>
  clearModel: () => void
  setModelOrientation: (o: ModelOrientation) => void
  setPickMode: (mode: PickMode) => void
  setHoverFace: (face: number | null) => void
  pickOnModel: (pick: { face: number; tri: number; point: Vec3 }) => void
  finishManualPick: () => void
  cancelManualPick: () => void
  planPath: () => Promise<void>
  connectIpp: (url?: string) => Promise<void>
  disconnectIpp: () => void
  setIppReturnsSurfacePoint: (value: boolean) => void
  setHardwareChannel: (channel: HardwareChannel) => void
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

export function placementOf(s: Pick<AppState, "calibration" | "nominalOnPallet">): RigidTransform {
  return nominalPartToMachine(palletToMachineOf(s), s.nominalOnPallet)
}

/** 安全平面：模型最高点（按名义装夹）之上 clearanceAbovePart。 */
export function clearanceZOf(s: Pick<AppState, "calibration" | "nominalOnPallet" | "model">, placement = placementOf(s)): number {
  const top = s.model ? modelBoundsIn(s.model, placement).max.z : applyPoint(placement, { x: 0, y: 0, z: 0 }).z
  return top + PROBE.clearanceAbovePart
}

/** 软件「认为」的世界：名义托盘 + 名义装夹。真机运行和路径预览都只能用它做干涉检查。 */
function nominalWorld(s: Pick<AppState, "calibration" | "nominalOnPallet" | "truth">): SimTruth {
  return {
    ...s.truth,
    palletToMachine: palletToMachineOf(s),
    partToPallet: s.nominalOnPallet,
    tipRadius: tipRadiusOf(s),
  }
}

function hardwareActive(s: Pick<AppState, "driveHardware" | "hardwareChannel" | "macc" | "ipp">): boolean {
  if (!s.driveHardware) return false
  return s.hardwareChannel === "ipp" ? s.ipp.connected : s.macc.connected
}

/** 自动编程用的零件模型：视觉识别到孔时用视觉孔位，否则用示例底板。 */
export function partModelOf(s: Pick<AppState, "visionDetections">): PlatePart {
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
export function partFrameOf(s: Pick<AppState, "calibration" | "evaluation" | "nominalOnPallet">): RigidTransform {
  return s.evaluation?.aligned ? s.evaluation.partToMachine : placementOf(s)
}

const liveMotion = () => {
  const s = useCmmStore.getState()
  if (!hardwareActive(s)) return motion
  return s.hardwareChannel === "ipp" ? ippMotion : hardwareMotion
}

const driver: ProbeDriver = {
  position: () => liveMotion().getSnapshot().position,
  moveTo: (p, speed) => liveMotion().moveTo(p, speed),
  probe: (d, maxTravel, speed, expected) =>
    liveMotion() === ippMotion ? ippMotion.probe(d, maxTravel, speed, expected) : liveMotion().probe(d, maxTravel, speed),
}

function nextName(program: MeasurementProgram, base: string): string {
  const used = new Set(program.steps.map((s) => s.name))
  let n = program.steps.filter((s) => s.name.startsWith(base)).length + 1
  while (used.has(`${base}${n}`)) n++
  return `${base}${n}`
}

function faceBaseName(face: FaceInfo, asLine: boolean): string {
  if (asLine) return "边"
  if (face.kind === "cylinder") return face.inner ? "孔" : "轴"
  if (face.kind === "sphere") return "球"
  if (face.kind === "plane") {
    const n = face.normal!
    if (n.z > 0.95) return "顶面"
    if (n.z < -0.95) return "底面"
    return "侧面"
  }
  return "点"
}

function autoGdt(step: ProgramStep): GdtCheck[] {
  if (step.kind === "plane") {
    return [
      {
        id: uid("gdt"),
        type: "flatness",
        name: `${step.name}平面度`,
        featureIds: [step.id],
        tolerance: 0.01,
      },
    ]
  }
  if (step.kind === "line") {
    return [
      {
        id: uid("gdt"),
        type: "straightness",
        name: `${step.name}直线度`,
        featureIds: [step.id],
        tolerance: 0.01,
      },
    ]
  }
  if (step.kind === "circle") {
    return [
      {
        id: uid("gdt"),
        type: "circularity",
        name: `${step.name}圆度`,
        featureIds: [step.id],
        tolerance: 0.008,
      },
      {
        id: uid("gdt"),
        type: "position",
        name: `${step.name}位置度`,
        featureIds: [step.id],
        tolerance: 0.03,
      },
    ]
  }
  return []
}

export const useCmmStore = create<AppState>((set, get) => {
  const runOptions = (placement: RigidTransform, clearanceZ: number): RunOptions => ({
    placement,
    clearanceZ,
    tipRadius: tipRadiusOf(get()),
    ...probeTravelsForRun({
      driveHardware: get().driveHardware,
      maccConnected: hardwareActive(get()),
      retractMm: get().setupTool?.retractMm,
      searchMm: get().setupTool?.searchMm,
    }),
    rapidSpeed: get().rapidSpeed,
    measureSpeed: get().measureSpeed,
    probeSpeed: get().probeSpeed,
    checkPath: (from, to) => {
      const world = hardwareActive(get()) ? nominalWorld(get()) : get().truth
      return segmentClearance(world, from, to) < 0
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
    set({
      running: true,
      runLabel: label,
      paused: false,
      abortRequested: false,
    })
    return true
  }

  const endRun = () =>
    set({
      running: false,
      paused: false,
      currentStepId: null,
      abortRequested: false,
    })

  const installModel = (model: PartModel, keepProgram: boolean) => {
    const modelDistance = createModelDistance(model)
    const nominalOnPallet = modelOnPallet(model, get().modelOrientation)
    const old = get().truth
    const truth = {
      ...createTruth(Math.random, { nominalOnPallet, model: modelDistance }),
      palletToMachine: old.palletToMachine,
      tipRadius: old.tipRadius,
    }
    const program: MeasurementProgram = keepProgram
      ? get().program
      : {
          id: uid("prog"),
          name: model.name.replace(/\.[^.]+$/, ""),
          steps: [],
          gdt: [],
          modelName: model.name,
        }
    if (!keepProgram) writeJson(PROGRAM_KEY, program)
    set({
      model,
      modelDistance,
      nominalOnPallet,
      truth,
      program,
      hits: [],
      evaluation: null,
      selectedStepId: null,
      pickMode: "face",
      pickedFace: null,
      manualPoints: [],
      plan: null,
      view: "machine",
    })
    const size = {
      x: model.max.x - model.min.x,
      y: model.max.y - model.min.y,
      z: model.max.z - model.min.z,
    }
    get().log(
      "info",
      `已导入模型 ${model.name}：${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)} mm，${model.faceCount} 个${
        model.faceSource === "brep" ? " B-rep 面" : "按法向分区的面（STL/OBJ 没有 B-rep）"
      }。点击模型上的面即可生成测点`,
    )
    if (keepProgram) void get().planPath()
  }

  const addPickedStep = (step: ProgramStep, note?: string) => {
    const s = get()
    const program: MeasurementProgram = {
      ...s.program,
      steps: [...s.program.steps, step],
      gdt: [...s.program.gdt, ...autoGdt(step)],
    }
    writeJson(PROGRAM_KEY, program)
    set({ program, selectedStepId: step.id, hits: [], evaluation: null })
    const what =
      step.kind === "circle"
        ? `${step.inner === false ? "轴" : "孔"} Ø${((step.nominalRadius ?? 0) * 2).toFixed(3)}`
        : step.kind === "sphere"
          ? `球 Ø${((step.nominalRadius ?? 0) * 2).toFixed(3)}`
          : KIND_NAME[step.kind]
    get().log("info", `已添加「${step.name}」：${what}，${step.points.length} 个测点${note ? `。${note}` : ""}`)
    void get().planPath()
  }

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
    geom21: emptyGeom21(),
    applyGeomOnImport: false,
    stepGauge: null,
    macc: emptyTelemetry(),
    driveHardware: false,
    maccBusy: false,
    setupTool: null,
    model: null,
    modelDistance: null,
    modelOrientation: { rx: 0, ry: 0, rz: 0 },
    nominalOnPallet: NOMINAL_PART_ON_PALLET,
    modelBusy: false,
    pickMode: "off",
    hoverFace: null,
    pickedFace: null,
    manualPoints: [],
    plan: null,
    planBusy: false,
    hardwareChannel: "ipp",
    ipp: ippMotion.getStatus(),
    ippBusy: false,
    ippSurfacePoint: true,

    hydrateFromStorage: () => {
      const program = readJson<MeasurementProgram>(PROGRAM_KEY)
      const report = readJson<ReportSnapshot>(REPORT_KEY)
      const calibration = readJson<PalletCalibration>(CALIBRATION_KEY)
      const machineTool = readJson<MachineToolConfig>(MACHINE_TOOL_KEY)
      const prefs = readJson<Partial<Prefs>>(PREFS_KEY)
      const geom21 = readJson<Geom21>(GEOM21_KEY)
      const orientation = readJson<ModelOrientation>(ORIENTATION_KEY)
      const ipp = readJson<{ url?: string; returnsSurfacePoint?: boolean }>(IPP_KEY)
      if (ipp?.returnsSurfacePoint !== undefined) ippMotion.setReturnsSurfacePoint(ipp.returnsSurfacePoint)
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
        ...(ipp?.returnsSurfacePoint !== undefined ? { ippSurfacePoint: ipp.returnsSurfacePoint } : {}),
        ...(program?.steps?.length || program?.modelName ? { program } : {}),
        ...(normalized ? { report: normalized } : {}),
        ...(calibration ? { calibration } : {}),
        ...(machineTool ? { machineTool: { ...DEFAULT_MACHINE_TOOL, ...machineTool } } : {}),
        ...(geom21 ? { geom21: { ...emptyGeom21(), ...geom21 } } : {}),
        ...(orientation ? { modelOrientation: orientation } : {}),
        ...(ipp?.url ? { ipp: { ...get().ipp, url: ipp.url } } : {}),
        ...(prefs?.inspectMode ? { inspectMode: prefs.inspectMode } : {}),
        ...(prefs?.partSerial !== undefined ? { partSerial: prefs.partSerial } : {}),
        ...(prefs?.thermal ? { thermal: { ...DEFAULT_THERMAL, ...prefs.thermal } } : {}),
        ...(prefs?.useDialYaw !== undefined ? { useDialYaw: prefs.useDialYaw } : {}),
      })
      void loadModelFile().then(async (file) => {
        if (!file || get().model) return
        set({ modelBusy: true })
        try {
          const model = await parseModelBuffer(file.name, file.buffer)
          installModel(model, get().program.modelName === model.name)
          get().log("info", `已恢复上次导入的模型 ${model.name}`)
        } catch {
          void clearModelFile()
        } finally {
          set({ modelBusy: false })
        }
      })
    },

    importModel: async (file) => {
      if (get().running) return
      set({ modelBusy: true })
      try {
        const buffer = await file.arrayBuffer()
        const model = await parseModelBuffer(file.name, buffer)
        installModel(model, false)
        void saveModelFile({ name: file.name, buffer }).catch(() => undefined)
      } catch (error) {
        get().log("error", error instanceof Error ? error.message : `无法解析 ${file.name}`)
      } finally {
        set({ modelBusy: false })
      }
    },

    loadSampleModel: async () => {
      if (get().running) return
      set({ modelBusy: true })
      try {
        const res = await fetch(SAMPLE_MODEL_URL)
        if (!res.ok) throw new Error(`示例模型下载失败（HTTP ${res.status}）`)
        const buffer = await res.arrayBuffer()
        const name = SAMPLE_MODEL_URL.split("/").pop()!
        const model = await parseModelBuffer(name, buffer)
        installModel(model, false)
        void saveModelFile({ name, buffer }).catch(() => undefined)
      } catch (error) {
        get().log("error", error instanceof Error ? error.message : "示例模型加载失败")
      } finally {
        set({ modelBusy: false })
      }
    },

    clearModel: () => {
      if (get().running) return
      void clearModelFile().catch(() => undefined)
      const old = get().truth
      set({
        model: null,
        modelDistance: null,
        nominalOnPallet: NOMINAL_PART_ON_PALLET,
        truth: {
          ...createTruth(),
          palletToMachine: old.palletToMachine,
          tipRadius: old.tipRadius,
        },
        pickMode: "off",
        hoverFace: null,
        pickedFace: null,
        manualPoints: [],
        plan: null,
      })
      get().resetDemoProgram()
    },

    setModelOrientation: (modelOrientation) => {
      const { model, modelDistance } = get()
      writeJson(ORIENTATION_KEY, modelOrientation)
      if (!model || !modelDistance) {
        set({ modelOrientation })
        return
      }
      const nominalOnPallet = modelOnPallet(model, modelOrientation)
      const old = get().truth
      const truth = {
        ...createTruth(Math.random, { nominalOnPallet, model: modelDistance }),
        palletToMachine: old.palletToMachine,
        tipRadius: old.tipRadius,
      }
      set({
        modelOrientation,
        nominalOnPallet,
        truth,
        hits: [],
        evaluation: null,
      })
      get().log(
        "info",
        `装夹朝向 RX ${modelOrientation.rx}° RY ${modelOrientation.ry}° RZ ${modelOrientation.rz}°，测点仍按 CAD 坐标`,
      )
      void get().planPath()
    },

    setPickMode: (pickMode) => set({ pickMode, manualPoints: [], pickedFace: null }),
    setHoverFace: (hoverFace) => {
      if (get().hoverFace !== hoverFace) set({ hoverFace })
    },

    pickOnModel: ({ face, tri, point }) => {
      const s = get()
      const { model, modelDistance, pickMode } = s
      if (!model || s.running || pickMode === "off") return
      const info = analyzeFace(model, face)
      set({ pickedFace: info })
      if (pickMode === "circle" || pickMode === "plane") {
        const normal = triNormalArea(model.positions, tri).n
        const manualPoints = [...s.manualPoints, { nominal: point, normal, face }]
        set({ manualPoints })
        s.log("info", `已拾取第 ${manualPoints.length} 点 (${point.x.toFixed(3)}, ${point.y.toFixed(3)}, ${point.z.toFixed(3)})`)
        return
      }
      if (pickMode === "point") {
        const normal = triNormalArea(model.positions, tri).n
        addPickedStep(singlePointStep(point, normal, nextName(s.program, "点")))
        return
      }
      const asLine = pickMode === "line"
      const built = featureFromFace(
        model,
        info,
        {
          tipRadius: tipRadiusOf(s),
          retract: PROBE.retract,
          distance: modelDistance ?? undefined,
          name: nextName(s.program, faceBaseName(info, asLine)),
        },
        asLine ? "line" : undefined,
      )
      if ("error" in built) {
        s.log("warn", `${FACE_KIND_LABEL[info.kind]}：${built.error}`)
        return
      }
      addPickedStep(built.step, built.note)
    },

    finishManualPick: () => {
      const s = get()
      const kind = s.pickMode
      if (kind !== "circle" && kind !== "plane") return
      if (s.manualPoints.length < 3) {
        s.log("warn", `${kind === "circle" ? "圆" : "平面"}至少需要 3 个点`)
        return
      }
      const id = uid("feat")
      const step = completeManualStep({
        id,
        kind,
        name: nextName(s.program, kind === "circle" ? "圆" : "平面"),
        points: s.manualPoints.map((p, i) => ({
          id: `${id}-pt-${i}`,
          nominal: p.nominal,
          approach: { x: -p.normal.x, y: -p.normal.y, z: -p.normal.z },
        })),
      })
      set({ manualPoints: [] })
      addPickedStep(step)
    },

    cancelManualPick: () => set({ manualPoints: [] }),

    planPath: async () => {
      const s = get()
      if (!s.program.steps.length) {
        set({ plan: null })
        return
      }
      set({ planBusy: true })
      try {
        const placement = placementOf(s)
        const world = nominalWorld(s)
        const plan = await planProgram(s.program, s.motion.position, {
          ...runOptions(placement, clearanceZOf(s, placement)),
          beforeMove: undefined,
          checkPath: (from, to) => (segmentClearance(world, from, to) < 0 ? "与名义模型或托盘干涉" : null),
        })
        set({ plan })
      } finally {
        set({ planBusy: false })
      }
    },

    connectIpp: async (url = DEFAULT_IPP_RELAY) => {
      set({ ippBusy: true })
      writeJson(IPP_KEY, { ...readJson<object>(IPP_KEY), url })
      try {
        ippMotion.setTipRadius(tipRadiusOf(get()))
        const limits = get().setupTool?.softLimits
        if (limits) ippMotion.setSoftLimits(limits)
        await ippMotion.connect(url)
        get().log(
          "info",
          `已连接 IPPServer（经 ${url}）。${ippMotion.getSnapshot().homed ? "机床已回零" : "机床未回零，请先回零"}`,
        )
      } catch (error) {
        set({ driveHardware: false })
        get().log("error", error instanceof Error ? error.message : "连接 IPPServer 失败")
      } finally {
        set({ ippBusy: false, ipp: ippMotion.getStatus() })
      }
    },

    disconnectIpp: () => {
      ippMotion.disconnect()
      set({
        driveHardware: get().hardwareChannel === "ipp" ? false : get().driveHardware,
        ipp: ippMotion.getStatus(),
      })
      get().log("info", "已断开 IPPServer")
    },

    setIppReturnsSurfacePoint: (ippSurfacePoint) => {
      ippMotion.setReturnsSurfacePoint(ippSurfacePoint)
      writeJson(IPP_KEY, {
        ...readJson<object>(IPP_KEY),
        returnsSurfacePoint: ippSurfacePoint,
      })
      set({ ippSurfacePoint })
    },

    log: (level, message) =>
      set((s) => ({
        logs: [{ id: uid("log"), at: nowIso(), level, message }, ...s.logs].slice(0, 120),
      })),

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
      set({ program, inspectMode, hits: [], evaluation: null, selectedStepId: null, currentStepId: null, plan: null })
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
          points: [
            {
              id: `${id}-pt-0`,
              nominal: { x: p.x, y: p.y, z: 0 },
              approach: { x: 0, y: 0, z: -1 },
            },
          ],
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
        return {
          program,
          selectedStepId: s.selectedStepId === id ? null : s.selectedStepId,
        }
      })
      get().log("info", "已删除特征")
      if (get().model) void get().planPath()
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
        const cur = liveMotion().getSnapshot().position
        await liveMotion().moveTo({ ...cur, z: nominalCenter.z + 30 }, get().rapidSpeed)
        const calibration = calibrateFromSphere(
          hits.map((h) => h.center),
          sphere.radius,
          sphere.center,
          PALLET.nominalToMachine,
        )
        writeJson(CALIBRATION_KEY, calibration)
        ippMotion.setTipRadius(calibration.tipRadius)
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
      const clearanceZ = clearanceZOf(get(), placement)
      set({
        hits: [],
        evaluation: null,
        currentStepId: program.steps[0]?.id ?? null,
      })
      get().log("info", `开始运行「${program.name}」`)
      try {
        const hits = await executeProgram(program, driver, {
          ...runOptions(placement, clearanceZ),
          onStep: (stepId) => {
            const step = program.steps.find((st) => st.id === stepId)
            set((s) => ({
              currentStepId: stepId,
              selectedStepId: stepId,
              hits: [...s.hits, { stepId, hits: [] }],
            }))
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
          nominalPartToPallet: get().nominalOnPallet,
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
          `测量完成。零件相对零点托盘偏差 X ${d.x.toFixed(4)} Y ${d.y.toFixed(4)} Z ${d.z.toFixed(4)} mm，旋转 ${d.rz.toFixed(4)}°`,
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
      const { modelDistance, nominalOnPallet } = get()
      const part = modelDistance ? { nominalOnPallet, model: modelDistance } : undefined
      const truth = {
        ...createTruth(Math.random, part),
        palletToMachine: old.palletToMachine,
        tipRadius: old.tipRadius,
      }
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
      set({
        visionImage: url,
        visionSize: { w: 480, h: 336 },
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
        visionSize: null,
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
        const steps = hits.map((hit, index) =>
          circleStep(uid("feat"), `视觉孔${index + 1}`, { x: hit.x, y: hit.y, z: -4 }, Math.round(hit.radius * 2) / 2),
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
        `已导出 SuperDMIS 程序 ${filename}。安装路径只能用英文、数字、-、_，不要放到带中文或空格的目录，否则 SuperDMIS 会无法保存/导出报告`,
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
          hardwareMotion.setMeasureParams({
            retractMm: setupTool.retractMm,
            retractSpeed: setupTool.retractSpeed,
          })
          if (setupTool.softLimits) ippMotion.setSoftLimits(setupTool.softLimits)
          set({
            setupTool,
            probeSpeed: setupTool.measureSpeed,
            measureSpeed: setupTool.positionSpeed,
            rapidSpeed: setupTool.positionSpeed,
          })
          get().log(
            "info",
            `已导入 SetupTool ${setupToolSummary(setupTool)}。工控机桥接连控制器时用该 IP/端口。仿真仍用 ${PROBE.searchTravel} mm 搜索行程。温度通道 ${setupTool.temperatureChannels.filter((c) => c).length}/16 已映射`,
          )
          return
        }
        if (detected.kind === "step-gauge") {
          set({ stepGauge: detected.data })
          get().log(
            "info",
            `已导入步距规真值 ${file.name}，${detected.data.segments.length} 段。这是 X-Inspect 校准用的证书数据，不是零件测点`,
          )
          return
        }
        if (detected.kind === "nonlinear") {
          writeJson(GEOM21_KEY, detected.data)
          set({ geom21: detected.data, applyGeomOnImport: true })
          get().log(
            "info",
            `已导入 X-Inspect 非线性补偿 ${file.name}：X ${tableSummary(detected.data.x)}，Y ${tableSummary(detected.data.y)}，Z ${tableSummary(detected.data.z)}。导入测点时可勾选施加补偿`,
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
        const importedThermal = appliedThermal(get().thermal)
        const evaluation = evaluateProgram(program, hits, {
          tipRadius: tipRadiusOf(get()),
          palletToMachine: palletToMachineOf(get()),
          nominalPartToPallet: get().nominalOnPallet,
          placement: placementOf(get()),
          thermal: importedThermal,
        })
        const report: ReportSnapshot = {
          mode: get().inspectMode,
          reportNo: `YJ-I-${Date.now().toString(36).toUpperCase()}`,
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
          thermal: importedThermal,
        }
        writeJson(REPORT_KEY, report)
        set({
          program,
          hits,
          evaluation,
          report,
          view: "coords",
          selectedStepId: program.steps[0]?.id ?? null,
        })
        const d = evaluation.pallet.delta
        get().log(
          "info",
          `已导入 ${file.name}（${data.format}${shouldComp ? "，已施加 21 项补偿" : ""}），${data.features.length} 个特征。${
            evaluation.aligned
              ? `已 3-2-1 找正，零件相对托盘偏差 X ${d.x.toFixed(4)} Y ${d.y.toFixed(4)} Z ${d.z.toFixed(4)} mm，旋转 ${d.rz.toFixed(4)}°`
              : evaluation.alignmentNote
          }`,
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
      const channel = get().hardwareChannel
      const online = channel === "ipp" ? get().ipp.connected : get().macc.connected
      if (driveHardware && !online) {
        get().log(
          "warn",
          channel === "ipp" ? "还没有连上 IPPServer，不能切到真机" : "还没有连上 MACC 桥接，不能把点动/自动运行切到真机",
        )
        return
      }
      const live = channel === "ipp" ? ippMotion : hardwareMotion
      set({
        driveHardware,
        motion: driveHardware ? live.getSnapshot() : motion.getSnapshot(),
      })
      get().log(
        driveHardware ? "warn" : "info",
        driveHardware
          ? `真机运动已打开：回零和预检程序走 ${channel === "ipp" ? "IPPServer（I++）" : "MACC"}。碰撞检查只能按名义模型，急停仍应走硬件回路。`
          : "已回到仿真控制器",
      )
    },

    setHardwareChannel: (hardwareChannel) => {
      if (get().running) return
      set({
        hardwareChannel,
        driveHardware: false,
        motion: motion.getSnapshot(),
      })
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
  motion.setTouchSensor((start, direction, maxTravel) => simulateTouch(useCmmStore.getState().truth, start, direction, maxTravel))
  motion.subscribe((snapshot) => {
    const s = useCmmStore.getState()
    if (hardwareActive(s)) return
    const prev = s.motion
    useCmmStore.setState({ motion: snapshot })
    if (snapshot.overtravel && snapshot.overtravel !== prev.overtravel) {
      useCmmStore.getState().log("warn", `${snapshot.overtravel.toUpperCase()} 轴软限位触发`)
    }
  })
  hardwareMotion.subscribe((snapshot) => {
    const s = useCmmStore.getState()
    if (!hardwareActive(s) || s.hardwareChannel !== "macc") return
    useCmmStore.setState({ motion: snapshot })
  })
  ippMotion.subscribe((snapshot) => {
    const s = useCmmStore.getState()
    if (!hardwareActive(s) || s.hardwareChannel !== "ipp") return
    useCmmStore.setState({ motion: snapshot })
  })
  ippMotion.subscribeStatus((ipp) => {
    useCmmStore.setState({ ipp })
  })
  hardwareMotion.subscribeTelemetry((macc) => {
    useCmmStore.setState({ macc })
  })
}
