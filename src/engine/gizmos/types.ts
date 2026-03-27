import type * as THREE from "three";

export interface GizmoLine {
  type: "line";
  from: THREE.Vector3;
  to: THREE.Vector3;
  color: string;
}

export interface GizmoSphere {
  type: "sphere";
  center: THREE.Vector3;
  radius: number;
  color: string;
}

export type GizmoDrawCall = GizmoLine | GizmoSphere;
