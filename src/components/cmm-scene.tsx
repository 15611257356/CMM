"use client"

import { OrbitControls } from "@react-three/drei"
import { Canvas, type ThreeEvent } from "@react-three/fiber"
import { MACHINE, type Vec3 } from "@/lib/geom"
import { PALLET, PLATE } from "@/lib/machine/setup"
import { add, scale } from "@/lib/math/linalg"
import { applyDir, applyPoint, type RigidTransform } from "@/lib/math/transform"
import type { PartModel } from "@/lib/model/types"
import { partToMachine } from "@/lib/sim/world"
import { partFrameOf, placementOf, useCmmStore } from "@/lib/store"
import { useEffect, useMemo, type ReactNode } from "react"
import { BufferAttribute, BufferGeometry, EdgesGeometry, Float32BufferAttribute, Matrix4 } from "three"

/** 机床坐标 (x, y, z) → three.js (x, z, y)，Z 朝上。 */
function m(x: number, y: number, z: number): [number, number, number] {
  return [x, z, y]
}

function useFrameMatrix(T: RigidTransform): Matrix4 {
  return useMemo(() => {
    const r = T.r
    const p = [0, 2, 1]
    const R = (i: number, j: number) => r[p[i] * 3 + p[j]]
    const t = m(T.t.x, T.t.y, T.t.z)
    return new Matrix4().set(
      R(0, 0),
      R(0, 1),
      R(0, 2),
      t[0],
      R(1, 0),
      R(1, 1),
      R(1, 2),
      t[1],
      R(2, 0),
      R(2, 1),
      R(2, 2),
      t[2],
      0,
      0,
      0,
      1,
    )
  }, [T])
}

function Frame({ T, children }: { T: RigidTransform; children: ReactNode }) {
  const matrix = useFrameMatrix(T)
  return (
    <group matrix={matrix} matrixAutoUpdate={false}>
      {children}
    </group>
  )
}

function Granite() {
  return (
    <group>
      {/* 台面和基座不要共面，否则拖动视角时深度缓冲会来回翻转，看起来像闪烁色块。 */}
      <mesh position={m(250, 200, -31)} receiveShadow>
        <boxGeometry args={[600, 60, 520]} />
        <meshStandardMaterial color="#5f646c" roughness={0.85} metalness={0.05} />
      </mesh>
      <mesh position={m(250, 200, -0.55)} receiveShadow>
        <boxGeometry args={[560, 0.9, 480]} />
        <meshStandardMaterial color="#7d838c" roughness={0.75} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} />
      </mesh>
      <mesh position={m(560, 200, 10)}>
        <boxGeometry args={[36, 20, 500]} />
        <meshStandardMaterial color="#2b3038" metalness={0.35} roughness={0.4} />
      </mesh>
    </group>
  )
}

function Pallet({ T }: { T: RigidTransform }) {
  const s = PALLET.referenceSphere
  const stemTop = s.center.z - s.radius * 0.8
  return (
    <Frame T={T}>
      <mesh position={m(0, 0, -PALLET.height / 2 - 0.2)} castShadow receiveShadow>
        <boxGeometry args={[PALLET.size.x, PALLET.height - 0.4, PALLET.size.y]} />
        <meshStandardMaterial color="#3d5a73" metalness={0.45} roughness={0.35} />
      </mesh>
      <mesh position={m(s.center.x, s.center.y, stemTop / 2)}>
        <cylinderGeometry args={[s.stemRadius, s.stemRadius, stemTop, 16]} />
        <meshStandardMaterial color="#9aa3ae" metalness={0.6} roughness={0.3} />
      </mesh>
      <mesh position={m(s.center.x, s.center.y, s.center.z)} castShadow>
        <sphereGeometry args={[s.radius, 32, 32]} />
        <meshStandardMaterial color="#f5f5f4" metalness={0.2} roughness={0.15} />
      </mesh>
    </Frame>
  )
}

function Part({ T, holes }: { T: RigidTransform; holes: { x: number; y: number; r: number }[] }) {
  return (
    <Frame T={T}>
      <mesh position={m(PLATE.w / 2, PLATE.d / 2, -PLATE.h / 2)} castShadow receiveShadow>
        <boxGeometry args={[PLATE.w, PLATE.h, PLATE.d]} />
        <meshStandardMaterial
          color="#c3c8d0"
          metalness={0.25}
          roughness={0.35}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
        />
      </mesh>
      {holes.map((h, i) => (
        <mesh key={i} position={m(h.x, h.y, -PLATE.h / 2 + 0.05)}>
          <cylinderGeometry args={[h.r, h.r, PLATE.h + 0.2, 32]} />
          <meshStandardMaterial color="#15181d" />
        </mesh>
      ))}
    </Frame>
  )
}

function NominalGhost({ T }: { T: RigidTransform }) {
  return (
    <Frame T={T}>
      <mesh position={m(PLATE.w / 2, PLATE.d / 2, -PLATE.h / 2)}>
        <boxGeometry args={[PLATE.w, PLATE.h, PLATE.d]} />
        <meshBasicMaterial
          color="#fbbf24"
          wireframe
          transparent
          opacity={0.45}
          polygonOffset
          polygonOffsetFactor={-2}
          polygonOffsetUnits={-2}
        />
      </mesh>
    </Frame>
  )
}

function Axes({ T, length = 45 }: { T: RigidTransform; length?: number }) {
  const w = 1.2
  return (
    <Frame T={T}>
      <mesh position={m(length / 2, 0, 0.8)}>
        <boxGeometry args={[length, w, w]} />
        <meshBasicMaterial color="#ef4444" />
      </mesh>
      <mesh position={m(0, length / 2, 0.8)}>
        <boxGeometry args={[w, w, length]} />
        <meshBasicMaterial color="#84cc16" />
      </mesh>
      <mesh position={m(0, 0, length / 2 + 0.8)}>
        <boxGeometry args={[w, length, w]} />
        <meshBasicMaterial color="#38bdf8" />
      </mesh>
    </Frame>
  )
}

const BEAM_Z = 390

function Bridge({ position, tipRadius }: { position: Vec3; tipRadius: number }) {
  const { x, y, z } = position
  const stylus = 32
  const ramBottom = z + stylus
  const ramTop = BEAM_Z - 10
  const ramLen = Math.max(20, ramTop - ramBottom + 60)
  return (
    <group>
      <mesh position={m(-40, y, BEAM_Z / 2)} castShadow>
        <boxGeometry args={[34, BEAM_Z, 40]} />
        <meshStandardMaterial color="#b9c0c9" metalness={0.35} roughness={0.35} />
      </mesh>
      <mesh position={m(560, y, BEAM_Z / 2)} castShadow>
        <boxGeometry args={[40, BEAM_Z, 60]} />
        <meshStandardMaterial color="#b9c0c9" metalness={0.35} roughness={0.35} />
      </mesh>
      <mesh position={m(260, y, BEAM_Z + 20)} castShadow>
        <boxGeometry args={[660, 44, 52]} />
        <meshStandardMaterial color="#cfd5dc" metalness={0.35} roughness={0.3} />
      </mesh>
      <mesh position={m(x, y, BEAM_Z + 20)} castShadow>
        <boxGeometry args={[70, 64, 72]} />
        <meshStandardMaterial color="#8b939d" metalness={0.45} roughness={0.3} />
      </mesh>
      <mesh position={m(x, y, ramBottom + ramLen / 2)} castShadow>
        <boxGeometry args={[30, ramLen, 30]} />
        <meshStandardMaterial color="#aab2bc" metalness={0.5} roughness={0.25} />
      </mesh>
      <mesh position={m(x, y, z + stylus / 2)}>
        <cylinderGeometry args={[0.9, 1.4, stylus, 12]} />
        <meshStandardMaterial color="#6b7280" metalness={0.6} />
      </mesh>
      <mesh position={m(x, y, z)}>
        <sphereGeometry args={[tipRadius, 20, 20]} />
        <meshStandardMaterial color="#c81e3a" metalness={0.7} roughness={0.15} />
      </mesh>
    </group>
  )
}

function SoftLimits() {
  return (
    <mesh position={m(MACHINE.xMax / 2, MACHINE.yMax / 2, MACHINE.zMax / 2)}>
      <boxGeometry args={[MACHINE.xMax, MACHINE.zMax, MACHINE.yMax]} />
      <meshBasicMaterial color="#5eead4" wireframe transparent opacity={0.12} />
    </mesh>
  )
}

function Touches() {
  const hits = useCmmStore((s) => s.hits)
  const evaluation = useCmmStore((s) => s.evaluation)
  const tip = useCmmStore((s) => s.calibration?.tipRadius ?? 2)
  const points = evaluation
    ? evaluation.features.flatMap((f) => f.surfacePoints)
    : hits.flatMap((h) => h.hits.map((hit) => add(hit.center, scale(hit.approach, tip))))
  return (
    <group>
      {points.map((p, i) => (
        <mesh key={i} position={m(p.x, p.y, p.z)}>
          <sphereGeometry args={[1.1, 10, 10]} />
          <meshStandardMaterial color="#38bdf8" emissive="#0ea5e9" emissiveIntensity={0.5} />
        </mesh>
      ))}
    </group>
  )
}

/** 机床坐标系是右手 Z 朝上，换到 three.js 要交换 y/z（镜像），所以三角形绕向也要翻一下。 */
function swizzledGeometry(model: PartModel, triangles?: number[]): BufferGeometry {
  const src = model.positions
  const list = triangles ?? null
  const count = list ? list.length : src.length / 9
  const out = new Float32Array(count * 9)
  for (let k = 0; k < count; k++) {
    const t = list ? list[k] : k
    for (const [dst, corner] of [
      [0, 0],
      [1, 2],
      [2, 1],
    ] as const) {
      const i = t * 9 + corner * 3
      const o = k * 9 + dst * 3
      out[o] = src[i]
      out[o + 1] = src[i + 2]
      out[o + 2] = src[i + 1]
    }
  }
  const g = new BufferGeometry()
  g.setAttribute("position", new BufferAttribute(out, 3))
  g.computeVertexNormals()
  return g
}

/** 原始三角形序号：swizzledGeometry 不重排，faceIndex 就是模型里的三角形号。 */
function useFaceTriangles(model: PartModel, face: number | null): number[] | null {
  return useMemo(() => {
    if (face === null) return null
    const out: number[] = []
    for (let t = 0; t < model.faceOf.length; t++) if (model.faceOf[t] === face) out.push(t)
    return out
  }, [model, face])
}

function FaceHighlight({ model, face, color }: { model: PartModel; face: number | null; color: string }) {
  const tris = useFaceTriangles(model, face)
  const geometry = useMemo(() => (tris ? swizzledGeometry(model, tris) : null), [model, tris])
  useEffect(() => () => geometry?.dispose(), [geometry])
  if (!geometry) return null
  return (
    <mesh geometry={geometry} renderOrder={2}>
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.55}
        depthTest
        polygonOffset
        polygonOffsetFactor={-4}
        polygonOffsetUnits={-4}
      />
    </mesh>
  )
}

function ModelPart({ model, T }: { model: PartModel; T: RigidTransform }) {
  const geometry = useMemo(() => swizzledGeometry(model), [model])
  useEffect(() => () => geometry.dispose(), [geometry])
  const pickMode = useCmmStore((s) => s.pickMode)
  const hoverFace = useCmmStore((s) => s.hoverFace)
  const pickedFace = useCmmStore((s) => s.pickedFace?.id ?? null)
  const setHoverFace = useCmmStore((s) => s.setHoverFace)
  const pickOnModel = useCmmStore((s) => s.pickOnModel)
  const running = useCmmStore((s) => s.running)
  const picking = pickMode !== "off" && !running

  const toPart = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    const local = e.object.worldToLocal(e.point.clone())
    return { x: local.x, y: local.z, z: local.y }
  }

  return (
    <Frame T={T}>
      <mesh
        geometry={geometry}
        castShadow
        receiveShadow
        onPointerMove={(e) => {
          if (!picking || e.faceIndex == null) return
          e.stopPropagation()
          setHoverFace(model.faceOf[e.faceIndex])
        }}
        onPointerOut={() => setHoverFace(null)}
        onClick={(e) => {
          if (!picking || e.faceIndex == null || e.delta > 4) return
          e.stopPropagation()
          pickOnModel({
            face: model.faceOf[e.faceIndex],
            tri: e.faceIndex,
            point: toPart(e),
          })
        }}
      >
        <meshStandardMaterial color="#c3c8d0" metalness={0.25} roughness={0.4} flatShading />
      </mesh>
      {picking ? <FaceHighlight model={model} face={hoverFace} color="#38bdf8" /> : null}
      <FaceHighlight model={model} face={pickedFace} color="#f59e0b" />
    </Frame>
  )
}

function ModelGhost({ model, T }: { model: PartModel; T: RigidTransform }) {
  const geometry = useMemo(() => {
    const base = swizzledGeometry(model)
    const edges = new EdgesGeometry(base, 25)
    base.dispose()
    return edges
  }, [model])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <Frame T={T}>
      <lineSegments geometry={geometry}>
        <lineBasicMaterial color="#fbbf24" transparent opacity={0.55} />
      </lineSegments>
    </Frame>
  )
}

function segmentsGeometry(segments: { a: Vec3; b: Vec3; color: [number, number, number] }[]): BufferGeometry {
  const pos = new Float32Array(segments.length * 6)
  const col = new Float32Array(segments.length * 6)
  segments.forEach((s, i) => {
    pos.set([...m(s.a.x, s.a.y, s.a.z), ...m(s.b.x, s.b.y, s.b.z)], i * 6)
    col.set([...s.color, ...s.color], i * 6)
  })
  const g = new BufferGeometry()
  g.setAttribute("position", new BufferAttribute(pos, 3))
  g.setAttribute("color", new Float32BufferAttribute(col, 3))
  return g
}

const MOVE_COLOR = {
  rapid: [0.45, 0.55, 0.65] as [number, number, number],
  approach: [0.2, 0.83, 0.6] as [number, number, number],
  touch: [0.98, 0.25, 0.35] as [number, number, number],
}

function PlannedPath() {
  const plan = useCmmStore((s) => s.plan)
  const geometry = useMemo(
    () =>
      plan
        ? segmentsGeometry(
            plan.moves.map((mv) => ({
              a: mv.from,
              b: mv.to,
              color: MOVE_COLOR[mv.kind],
            })),
          )
        : null,
    [plan],
  )
  useEffect(() => () => geometry?.dispose(), [geometry])
  if (!geometry) return null
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial vertexColors transparent opacity={0.9} />
    </lineSegments>
  )
}

/** 程序里的名义测点（按当前零件坐标系画）和触测方向，选中的特征高亮。 */
function ProgramPoints({ T }: { T: RigidTransform }) {
  const steps = useCmmStore((s) => s.program.steps)
  const selected = useCmmStore((s) => s.selectedStepId)
  const manual = useCmmStore((s) => s.manualPoints)
  const points = useMemo(
    () =>
      steps.flatMap((st) =>
        st.points.map((p) => ({
          key: p.id,
          at: applyPoint(T, p.nominal),
          dir: applyDir(T, p.approach),
          active: st.id === selected,
        })),
      ),
    [steps, selected, T],
  )
  const arrows = useMemo(
    () =>
      segmentsGeometry(
        points.map((p) => ({
          a: add(p.at, scale(p.dir, -9)),
          b: p.at,
          color: p.active ? [0.98, 0.62, 0.04] : [0.99, 0.83, 0.3],
        })),
      ),
    [points],
  )
  useEffect(() => () => arrows.dispose(), [arrows])
  const manualAt = manual.map((p) => applyPoint(T, p.nominal))
  return (
    <group>
      <lineSegments geometry={arrows}>
        <lineBasicMaterial vertexColors />
      </lineSegments>
      {points.map((p) => (
        <mesh key={p.key} position={m(p.at.x, p.at.y, p.at.z)}>
          <sphereGeometry args={[p.active ? 1.4 : 1, 10, 10]} />
          <meshBasicMaterial color={p.active ? "#f59e0b" : "#fde68a"} />
        </mesh>
      ))}
      {manualAt.map((p, i) => (
        <mesh key={`manual-${i}`} position={m(p.x, p.y, p.z)}>
          <sphereGeometry args={[1.5, 12, 12]} />
          <meshBasicMaterial color="#e879f9" />
        </mesh>
      ))}
    </group>
  )
}

function SceneContents() {
  const position = useCmmStore((s) => s.motion.position)
  const truth = useCmmStore((s) => s.truth)
  const calibration = useCmmStore((s) => s.calibration)
  const evaluation = useCmmStore((s) => s.evaluation)
  const model = useCmmStore((s) => s.model)
  const nominalOnPallet = useCmmStore((s) => s.nominalOnPallet)
  const hardware = useCmmStore((s) => s.driveHardware)
  const actualPart = useMemo(() => partToMachine(truth), [truth])
  const nominal = useMemo(() => placementOf({ calibration, nominalOnPallet }), [calibration, nominalOnPallet])
  const partFrame = useMemo(
    () => partFrameOf({ calibration, evaluation, nominalOnPallet }),
    [calibration, evaluation, nominalOnPallet],
  )
  return (
    <>
      <color attach="background" args={["#12151b"]} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[260, 520, 260]} intensity={1.1} />
      <directionalLight position={[-200, 200, -140]} intensity={0.35} />
      <group position={[-250, 0, -200]}>
        <Granite />
        <Pallet T={truth.palletToMachine} />
        {model ? (
          <>
            {/* 真机时软件不知道零件真实位置，只能画在名义/已找正的位置上。 */}
            <ModelPart model={model} T={hardware ? partFrame : actualPart} />
            <ModelGhost model={model} T={nominal} />
            <ProgramPoints T={partFrame} />
            <PlannedPath />
          </>
        ) : (
          <>
            <Part T={actualPart} holes={truth.holes} />
            <NominalGhost T={nominal} />
          </>
        )}
        {evaluation?.aligned ? <Axes T={evaluation.partToMachine} /> : null}
        <Bridge position={position} tipRadius={truth.tipRadius} />
        <SoftLimits />
        <Touches />
      </group>
      <gridHelper args={[800, 32, "#3f4652", "#2a3038"]} position={[0, -60, 0]} />
      <OrbitControls makeDefault minDistance={120} maxDistance={1600} target={[0, 70, 0]} />
    </>
  )
}

export function CmmScene() {
  return (
    <Canvas
      camera={{ position: [640, 560, 760], fov: 40, near: 8, far: 4000 }}
      dpr={[1, 1.5]}
      gl={{
        antialias: true,
        alpha: false,
        stencil: false,
        powerPreference: "high-performance",
      }}
      style={{ background: "#12151b" }}
    >
      <SceneContents />
    </Canvas>
  )
}
