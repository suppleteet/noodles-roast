import * as THREE from "three";
import type { SecondaryMotionConfig } from "../types";
import { SecondaryMotion } from "./SecondaryMotion";

/**
 * Quaternion secondary motion.
 * Decomposes the delta rotation into axis-angle, runs SecondaryMotion on the
 * angle magnitude, and reconstructs. Handles shortest-path via dot product.
 */
export class SecondaryMotionQuat {
  private sm: SecondaryMotion;
  private currentQ: THREE.Quaternion = new THREE.Quaternion();
  private axisBuffer: THREE.Vector3 = new THREE.Vector3(0, 1, 0);
  private initialized: boolean = false;
  private _negated: THREE.Quaternion = new THREE.Quaternion();
  private _delta: THREE.Quaternion = new THREE.Quaternion();
  private _result: THREE.Quaternion = new THREE.Quaternion();

  constructor(config: SecondaryMotionConfig) {
    this.sm = new SecondaryMotion(config);
  }

  setStart(q: THREE.Quaternion): void {
    this.currentQ.copy(q);
    this.sm.setStart(0);
    this.initialized = true;
  }

  tick(target: THREE.Quaternion, dt: number): THREE.Quaternion {
    if (!this.initialized) this.setStart(target);

    // Ensure shortest path — negate all components if dot product is negative
    const dot = this.currentQ.dot(target);
    let t: THREE.Quaternion;
    if (dot < 0) {
      this._negated.set(-target.x, -target.y, -target.z, -target.w);
      t = this._negated;
    } else {
      t = target;
    }

    // Extract delta from current to target
    this._delta.copy(this.currentQ).invert().multiply(t);
    this._delta.normalize();

    // Decompose to axis-angle
    const angle = 2 * Math.acos(Math.min(1, Math.abs(this._delta.w)));
    const sinHalf = Math.sqrt(1 - this._delta.w * this._delta.w);
    if (sinHalf > 1e-6) {
      this.axisBuffer.set(this._delta.x / sinHalf, this._delta.y / sinHalf, this._delta.z / sinHalf);
    }

    // Run secondary on angle
    const smoothedAngle = this.sm.tick(angle, dt);

    // Reconstruct quaternion from smoothed angle
    this._result.setFromAxisAngle(this.axisBuffer, smoothedAngle);
    this._result.premultiply(this.currentQ);
    this._result.normalize();

    this.currentQ.copy(this._result);
    return this._result;
  }

  updateConfig(config: Partial<SecondaryMotionConfig>): void {
    this.sm.updateConfig(config);
  }
}
