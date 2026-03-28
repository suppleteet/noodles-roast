import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Mesh } from "three";
import { useSessionStore } from "@/store/useSessionStore";
import { makeSpring, springStep } from "@/lib/spring";

// Tuned for snappy-open, smooth-close mouth animation
const STIFFNESS = 600;  // high = fast response
const DAMPING = 35;     // slightly underdamped for springy feel

/**
 * Drives the `mouth_open` morph target weight from audio amplitude.
 * Uses a spring for smooth, responsive motion with slight overshoot.
 */
export function useMouthSync(meshRef: React.RefObject<Mesh | null>) {
  const springRef = useRef(makeSpring(0));

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    if (!mesh?.morphTargetInfluences || !mesh.morphTargetDictionary) return;

    const amplitude = useSessionStore.getState().audioAmplitude;
    const target = amplitude * 0.9;

    springRef.current = springStep(springRef.current, target, STIFFNESS, DAMPING, delta);
    const value = Math.max(0, Math.min(1, springRef.current.value));

    const idx = mesh.morphTargetDictionary["mouth_open"];
    if (idx !== undefined) {
      mesh.morphTargetInfluences[idx] = value;
    }
  });
}
