import * as THREE from "three";
import type { GizmoDrawCall } from "./types";

/**
 * Build gizmo draw calls for a verlet chain.
 * Blue spheres at simulation points, cyan lines between consecutive points,
 * gray lines from each point to its rest/bone target.
 */
export function buildVerletGizmos(
  simPositions: THREE.Vector3[],
  restTargets: THREE.Vector3[]
): GizmoDrawCall[] {
  const calls: GizmoDrawCall[] = [];

  for (let i = 0; i < simPositions.length; i++) {
    // Sphere at sim point
    calls.push({
      type: "sphere",
      center: simPositions[i].clone(),
      radius: 0.006,
      color: "#4488ff",
    });

    // Cyan line to next sim point
    if (i < simPositions.length - 1) {
      calls.push({
        type: "line",
        from: simPositions[i].clone(),
        to: simPositions[i + 1].clone(),
        color: "#44ffff",
      });
    }

    // Gray line to rest target
    if (i < restTargets.length) {
      calls.push({
        type: "line",
        from: simPositions[i].clone(),
        to: restTargets[i].clone(),
        color: "#666666",
      });
    }
  }

  return calls;
}
