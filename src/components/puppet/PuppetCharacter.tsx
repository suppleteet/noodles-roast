"use client";
import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { useMouthSync } from "./useMouthSync";
import { useMotionState } from "./useMotionState";
import { useSpringPhysics } from "./useSpringPhysics";
import type { SpringTargets } from "./useSpringPhysics";
import { useSessionStore } from "@/store/useSessionStore";

interface Props {
  modelUrl?: string;
}

export default function PuppetCharacter({ modelUrl = "/models/puppet-default.glb" }: Props) {
  const groupRef = useRef<THREE.Group>(null);
  const jawMeshRef = useRef<THREE.Mesh | null>(null);
  const bodyRef = useRef<THREE.Group | null>(null);

  // Spring targets (written by useMotionState, read by useSpringPhysics)
  const targets = useRef<SpringTargets>({ pitch: 0, yaw: 0, roll: 0, bobY: 0 });

  const { stiffnessRef, dampingRef } = useMotionState(targets);
  const springs = useSpringPhysics(stiffnessRef, dampingRef, targets);
  useMouthSync(jawMeshRef as React.RefObject<THREE.Mesh | null>);

  // Try to load the GLB; fall back to placeholder mesh on error
  let gltf: ReturnType<typeof useGLTF> | null = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    gltf = useGLTF(modelUrl);
  } catch {
    gltf = null;
  }

  // Find jaw mesh and body in the loaded scene
  useMemo(() => {
    if (!gltf?.scene) return;
    gltf.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        const name = obj.name.toLowerCase();
        if (name.includes("jaw") || (obj.morphTargetDictionary && "mouth_open" in obj.morphTargetDictionary)) {
          jawMeshRef.current = obj;
        }
      }
      if (obj instanceof THREE.Group && obj.name.toLowerCase().includes("body")) {
        bodyRef.current = obj;
      }
    });
  }, [gltf]);

  // Apply spring values to puppet bones each frame
  useFrame(() => {
    const s = springs.current;
    if (groupRef.current) {
      groupRef.current.rotation.x = s.pitch.value;
      groupRef.current.rotation.y = s.yaw.value;
      groupRef.current.rotation.z = s.roll.value;
      groupRef.current.position.y = s.bobY.value;
    }
  });

  if (gltf?.scene) {
    return (
      <group ref={groupRef}>
        <primitive object={gltf.scene} scale={1} />
      </group>
    );
  }

  // Placeholder Muppet-ish mesh when no GLB is available
  return (
    <group ref={groupRef} position={[0, 0, 0]}>
      {/* Body */}
      <mesh position={[0, -0.4, 0]}>
        <boxGeometry args={[1.2, 1.0, 0.6]} />
        <meshStandardMaterial color="#e05c00" roughness={0.9} />
      </mesh>
      {/* Upper head */}
      <mesh position={[0, 0.45, 0]}>
        <boxGeometry args={[1.1, 0.7, 0.65]} />
        <meshStandardMaterial color="#e05c00" roughness={0.9} />
      </mesh>
      {/* Lower jaw — driven by morph sim via position */}
      <JawMesh jawMeshRef={jawMeshRef} />
      {/* Eyes */}
      <mesh position={[-0.22, 0.55, 0.34]}>
        <sphereGeometry args={[0.14, 16, 16]} />
        <meshStandardMaterial color="white" />
      </mesh>
      <mesh position={[0.22, 0.55, 0.34]}>
        <sphereGeometry args={[0.14, 16, 16]} />
        <meshStandardMaterial color="white" />
      </mesh>
      {/* Pupils */}
      <mesh position={[-0.22, 0.55, 0.47]}>
        <sphereGeometry args={[0.07, 16, 16]} />
        <meshStandardMaterial color="#111" />
      </mesh>
      <mesh position={[0.22, 0.55, 0.47]}>
        <sphereGeometry args={[0.07, 16, 16]} />
        <meshStandardMaterial color="#111" />
      </mesh>
    </group>
  );
}

/** Jaw mesh that simulates mouth_open via Y rotation */
function JawMesh({ jawMeshRef }: { jawMeshRef: React.MutableRefObject<THREE.Mesh | null> }) {
  const meshRef = useRef<THREE.Mesh>(null);

  // Wire jawMeshRef to this mesh
  useMemo(() => {
    jawMeshRef.current = meshRef.current;
    // Add a fake morphTargetDictionary so useMouthSync still works
    if (meshRef.current && !meshRef.current.morphTargetDictionary) {
      meshRef.current.morphTargetDictionary = { mouth_open: 0 };
      meshRef.current.morphTargetInfluences = [0];
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drive jaw rotation from store amplitude directly (fallback for placeholder)
  useFrame(() => {
    if (!meshRef.current) return;
    const amp = getAmplitude();
    meshRef.current.rotation.x = amp * 0.6; // open downward
  });

  return (
    <mesh ref={meshRef} position={[0, 0.12, 0.05]}>
      <boxGeometry args={[0.9, 0.28, 0.6]} />
      <meshStandardMaterial color="#c94500" roughness={0.9} />
    </mesh>
  );
}

function getAmplitude(): number {
  return useSessionStore.getState().audioAmplitude;
}
