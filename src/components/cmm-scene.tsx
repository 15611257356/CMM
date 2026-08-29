"use client"

import { OrbitControls } from "@react-three/drei"
import { Canvas } from "@react-three/fiber"
import { PLATE, type Vec3 } from "@/lib/geom"
import { useCmmStore } from "@/lib/store"

function m(x: number, y: number, z: number): [number, number, number] {
  return [x, z, y]
}

function Granite() {
  return (
    <group>
      <mesh position={m(200, 150, -22)} castShadow receiveShadow>
        <boxGeometry args={[460, 44, 360]} />
        <meshStandardMaterial color="#6d7178" roughness={0.82} metalness={0.08} />
      </mesh>
      <mesh position={m(200, 150, 0.4)} receiveShadow>
        <boxGeometry args={[400, 1.2, 300]} />
        <meshStandardMaterial color="#8b9098" roughness={0.7} />
      </mesh>
      <mesh position={m(200, -18, 6)}>
        <boxGeometry args={[420, 14, 22]} />
        <meshStandardMaterial color="#2b3038" metalness={0.35} roughness={0.4} />
      </mesh>
      <mesh position={m(200, 318, 6)}>
        <boxGeometry args={[420, 14, 22]} />
        <meshStandardMaterial color="#2b3038" metalness={0.35} roughness={0.4} />
      </mesh>
    </group>
  )
}

function Workpiece() {
  return (
    <group>
      <mesh position={m(PLATE.x + PLATE.w / 2, PLATE.y + PLATE.d / 2, PLATE.h / 2)} castShadow>
        <boxGeometry args={[PLATE.w, PLATE.h, PLATE.d]} />
        <meshStandardMaterial color="#c3c8d0" metalness={0.25} roughness={0.35} />
      </mesh>
      {PLATE.holes.map((hole) => (
        <mesh key={hole.id} position={m(hole.x, hole.y, PLATE.h / 2 + 0.2)}>
          <cylinderGeometry args={[hole.r, hole.r, PLATE.h + 1.2, 24]} />
          <meshStandardMaterial color="#1a1d22" />
        </mesh>
      ))}
    </group>
  )
}

function Bridge({ position }: { position: Vec3 }) {
  const x = position.x
  const y = position.y
  const z = position.z
  const ramLen = Math.max(24, 228 - z)
  return (
    <group>
      <mesh position={m(x, -24, 114)} castShadow>
        <boxGeometry args={[26, 228, 26]} />
        <meshStandardMaterial color="#d8a11a" metalness={0.4} roughness={0.35} />
      </mesh>
      <mesh position={m(x, 324, 114)} castShadow>
        <boxGeometry args={[26, 228, 26]} />
        <meshStandardMaterial color="#d8a11a" metalness={0.4} roughness={0.35} />
      </mesh>
      <mesh position={m(x, 150, 232)} castShadow>
        <boxGeometry args={[34, 22, 372]} />
        <meshStandardMaterial color="#e0b020" metalness={0.45} roughness={0.3} />
      </mesh>
      <mesh position={m(x, y, 220)} castShadow>
        <boxGeometry args={[42, 38, 52]} />
        <meshStandardMaterial color="#3a404a" metalness={0.5} roughness={0.3} />
      </mesh>
      <mesh position={m(x, y, z + ramLen / 2)} castShadow>
        <boxGeometry args={[14, ramLen, 14]} />
        <meshStandardMaterial color="#9aa3ae" metalness={0.55} roughness={0.25} />
      </mesh>
      <mesh position={m(x, y, z + 9)}>
        <cylinderGeometry args={[1.3, 1.6, 14, 12]} />
        <meshStandardMaterial color="#6b7280" metalness={0.6} />
      </mesh>
      <mesh position={m(x, y, z)}>
        <sphereGeometry args={[3.1, 18, 18]} />
        <meshStandardMaterial color="#c81e3a" metalness={0.7} roughness={0.15} />
      </mesh>
    </group>
  )
}

function SoftLimits() {
  return (
    <mesh position={m(200, 150, 100)}>
      <boxGeometry args={[400, 200, 300]} />
      <meshBasicMaterial color="#5eead4" wireframe transparent opacity={0.18} />
    </mesh>
  )
}

function MeasuredPoints() {
  const results = useCmmStore((s) => s.results)
  const program = useCmmStore((s) => s.program)
  const points = program.steps.flatMap((step) => step.points).filter((p) => p.measured)
  return (
    <group>
      {points.map((p) => (
        <mesh key={p.id} position={m(p.measured!.x, p.measured!.y, p.measured!.z)}>
          <sphereGeometry args={[1.4, 10, 10]} />
          <meshStandardMaterial color="#38bdf8" emissive="#0ea5e9" emissiveIntensity={0.4} />
        </mesh>
      ))}
      {results
        .filter((r) => r.circle)
        .map((r) => (
          <mesh key={r.stepId} position={m(r.circle!.cx, r.circle!.cy, r.circle!.cz + 0.6)}>
            <ringGeometry args={[r.circle!.radius - 0.4, r.circle!.radius + 0.4, 32]} />
            <meshBasicMaterial color="#22d3ee" />
          </mesh>
        ))}
    </group>
  )
}

function SceneContents() {
  const position = useCmmStore((s) => s.motion.position)
  return (
    <>
      <color attach="background" args={["#12151b"]} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[180, 320, 160]} intensity={1.15} />
      <directionalLight position={[-80, 120, -60]} intensity={0.35} />
      <group position={[-200, 0, -150]}>
        <Granite />
        <Workpiece />
        <Bridge position={position} />
        <SoftLimits />
        <MeasuredPoints />
      </group>
      <gridHelper args={[520, 26, "#3f4652", "#2a3038"]} position={[0, -44, 0]} />
      <OrbitControls makeDefault minDistance={180} maxDistance={900} target={[0, 40, 0]} />
    </>
  )
}

export function CmmScene() {
  return (
    <Canvas camera={{ position: [280, 210, 310], fov: 42 }} dpr={[1, 1.6]}>
      <SceneContents />
    </Canvas>
  )
}
