import { useFrame } from "@react-three/fiber";
import type { Mesh } from "three";
import { useSessionStore } from "@/store/useSessionStore";

/**
 * Drives the `mouth_open` morph target weight from audio amplitude.
 * Call this inside a component that has access to the mesh ref.
 */
export function useMouthSync(meshRef: React.RefObject<Mesh | null>) {
  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh?.morphTargetInfluences || !mesh.morphTargetDictionary) return;

    const amplitude = useSessionStore.getState().audioAmplitude;

    const idx = mesh.morphTargetDictionary["mouth_open"];
    if (idx !== undefined) {
      mesh.morphTargetInfluences[idx] = amplitude * 0.9; // max 90% open
    }
  });
}
