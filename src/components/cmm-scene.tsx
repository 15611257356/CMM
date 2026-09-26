"use client"

import { OrbitControls } from "@react-three/drei"
import { Canvas } from "@react-three/fiber"
import { MACHINE, type Vec3 } from "@/lib/geom"
import { PALLET, PLATE } from "@/lib/machine/setup"
import { add, scale } from "@/lib/math/linalg"
import type { RigidTransform } from "@/lib/math/transform"
import { partToMachine } from "@/lib/sim/world"
import { placementOf, useCmmStore } from "@/lib/store"
import { useMemo, type ReactNode } from "react"
import { Matrix4 } from "three"

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
      R(0, 0), R(0, 1), R(0, 2), t[0],
      R(1, 0), R(1, 1), R(1, 2), t[1],
      R(2, 0), R(2, 1), R(2, 2), t[2],
      0, 0, 0, 1
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
      <mesh position={m(250, 200, -30)} receiveShadow>
        <boxGeometry args={[600, 60, 520]} />
        <meshStandardMaterial color="#5f646c" roughness={0.85} metalness={0.05} />
      </mesh>
      <mesh position={m(250, 200, 0.3)} receiveShadow>
        <boxGeometry args={[560, 0.6, 480]} />
        <meshStandardMaterial color="#7d838c" roughness={0.75} />
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
      <mesh position={m(0, 0, -PALLET.height / 2)} castShadow receiveShadow>
        <boxGeometry args={[PALLET.size.x, PALLET.height, PALLET.size.y]} />
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
        <meshStandardMaterial color="#c3c8d0" metalness={0.25} roughness={0.35} />
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
        <meshBasicMaterial color="#fbbf24" wireframe transparent opacity={0.35} />
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

function SceneContents() {
  const position = useCmmStore((s) => s.motion.position)
  const truth = useCmmStore((s) => s.truth)
  const calibration = useCmmStore((s) => s.calibration)
  const evaluation = useCmmStore((s) => s.evaluation)
  const actualPart = useMemo(() => partToMachine(truth), [truth])
  const nominal = useMemo(() => placementOf({ calibration }), [calibration])
  return (
    <>
      <color attach="background" args={["#12151b"]} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[260, 520, 260]} intensity={1.1} />
      <directionalLight position={[-200, 200, -140]} intensity={0.35} />
      <group position={[-250, 0, -200]}>
        <Granite />
        <Pallet T={truth.palletToMachine} />
        <Part T={actualPart} holes={truth.holes} />
        <NominalGhost T={nominal} />
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
    <Canvas camera={{ position: [520, 460, 620], fov: 40, far: 5000 }} dpr={[1, 1.6]}>
      <SceneContents />
    </Canvas>
  )
}
