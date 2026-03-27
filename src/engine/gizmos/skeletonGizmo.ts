import * as THREE from "three";
import type { BoneMap } from "../types";
import type { GizmoDrawCall } from "./types";

/**
 * Build gizmo draw calls for a skeleton.
 * Lines connect each bone to its parent; spheres mark each bone position.
 * Color by depth: root=red, leaf=green, intermediate=yellow.
 */
export function buildSkeletonGizmos(bones: BoneMap): GizmoDrawCall[] {
  const calls: GizmoDrawCall[] = [];
  const boneList = Array.from(bones.values());

  // Find max depth for color interpolation
  const depthMap = new Map<THREE.Bone, number>();
  function calcDepth(bone: THREE.Bone, depth: number) {
    depthMap.set(bone, depth);
    for (const child of bone.children) {
      if (child instanceof THREE.Bone) calcDepth(child, depth + 1);
    }
  }
  for (const bone of boneList) {
    if (!(bone.parent instanceof THREE.Bone)) calcDepth(bone, 0);
  }
  const maxDepth = Math.max(1, ...Array.from(depthMap.values()));

  const worldPos = new THREE.Vector3();
  const parentWorldPos = new THREE.Vector3();

  for (const bone of boneList) {
    const depth = depthMap.get(bone) ?? 0;
    const t = depth / maxDepth;
    // root=red, mid=yellow, leaf=green
    const color = t < 0.5
      ? `hsl(${Math.round(t * 2 * 60)}, 100%, 55%)`   // red→yellow
      : `hsl(${Math.round(60 + (t - 0.5) * 2 * 60)}, 100%, 55%)`; // yellow→green

    bone.getWorldPosition(worldPos);

    // Sphere at bone position
    calls.push({ type: "sphere", center: worldPos.clone(), radius: 0.008, color });

    // Line to parent bone
    if (bone.parent instanceof THREE.Bone) {
      bone.parent.getWorldPosition(parentWorldPos);
      calls.push({
        type: "line",
        from: parentWorldPos.clone(),
        to: worldPos.clone(),
        color,
      });
    }
  }

  return calls;
}
