"use client";
import { useRef, memo, useEffect, Suspense } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { useSessionStore } from "@/store/useSessionStore";
import PuppetCharacter from "./PuppetCharacter";

// Memoized with no props so it never re-renders — prevents R3F from resetting
// imperative intensity mutations back to JSX-prop values on parent re-renders.
const SceneLights = memo(function SceneLights() {
  const ambientRef = useRef<THREE.AmbientLight>(null);
  const dirRef     = useRef<THREE.DirectionalLight>(null);
  const pointRef   = useRef<THREE.PointLight>(null);
  const awakeRef   = useRef(false);
  const { scene }  = useThree();

  // Initialize environmentIntensity to dim before the first frame paints
  useEffect(() => {
    (scene as THREE.Scene & { environmentIntensity: number }).environmentIntensity = 0.04;
  }, [scene]);

  useFrame(() => {
    const { phase, audioAmplitude } = useSessionStore.getState();
    // Latch: once audio is heard this session, stay awake until phase leaves roasting
    if (phase !== "roasting") awakeRef.current = false;
    if (phase === "roasting" && audioAmplitude > 0.03) awakeRef.current = true;
    const t = awakeRef.current ? 1.0 : 0.04;
    const k = 0.07;
    if (ambientRef.current) ambientRef.current.intensity += (0.4 * t - ambientRef.current.intensity) * k;
    if (dirRef.current)     dirRef.current.intensity     += (1.2 * t - dirRef.current.intensity)     * k;
    if (pointRef.current)   pointRef.current.intensity   += (0.5 * t - pointRef.current.intensity)   * k;
    // Also dim the IBL from <Environment> — set each frame so it isn't overridden
    (scene as THREE.Scene & { environmentIntensity: number }).environmentIntensity += (t - (scene as THREE.Scene & { environmentIntensity: number }).environmentIntensity) * k;
  });

  // Start at sleeping brightness so any accidental re-render resets to dim, not bright
  return (
    <>
      <ambientLight ref={ambientRef} intensity={0.016} />
      <directionalLight ref={dirRef} position={[2, 4, 3]} intensity={0.048} castShadow shadow-mapSize={[1024, 1024]} />
      <pointLight ref={pointRef} position={[-2, 2, 2]} intensity={0.02} color="#ff6030" />
    </>
  );
});

interface Props {
  canvasRef?: React.RefObject<HTMLCanvasElement | null>;
}

export default function PuppetScene({ canvasRef }: Props) {
  return (
    <Canvas
      ref={canvasRef}
      gl={{ preserveDrawingBuffer: true, antialias: true }}
      camera={{ position: [0, 0.2, 9.2], fov: 40 }}
      className="w-full h-full"
      shadows
    >
      <color attach="background" args={["#1a0a00"]} />
      <SceneLights />

      <Suspense fallback={null}>
        <PuppetCharacter />
        <Environment preset="studio" />
      </Suspense>

      {/* Dev only: orbit controls for positioning */}
      {process.env.NODE_ENV === "development" && (
        <OrbitControls enablePan={false} maxPolarAngle={Math.PI * 0.6} />
      )}
    </Canvas>
  );
}
