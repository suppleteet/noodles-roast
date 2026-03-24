import { useFrame } from "@react-three/fiber";
import type { Mesh } from "three";
import { useSessionStore } from "@/store/useSessionStore";
import { useRef } from "react";

/**
 * Drives the `mouth_open` morph target weight from audio amplitude.
 * Call this inside a component that has access to the mesh ref.
 */
export function useMouthSync(meshRef: React.RefObject<Mesh | null>) {
  const currentWeight = useRef(0);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh?.morphTargetInfluences || !mesh.morphTargetDictionary) return;

    const amplitude = useSessionStore.getState().audioAmplitude;
    // const target = amplitude * 0.9; // max 90% open
    // // Smooth lerp — jaw follows amplitude quickly
    // currentWeight.current += (target - currentWeight.current) * 0.75;

    const idx = mesh.morphTargetDictionary["mouth_open"];
    if (idx !== undefined) {
      mesh.morphTargetInfluences[idx] = currentWeight.current;
    }
  });
}
