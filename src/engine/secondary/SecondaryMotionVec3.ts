import * as THREE from "three";
import type { SecondaryMotionConfig } from "../types";
import { SecondaryMotion } from "./SecondaryMotion";

/**
 * Three-channel wrapper around SecondaryMotion.
 * Gravity is applied to the Y channel only.
 */
export class SecondaryMotionVec3 {
  private x: SecondaryMotion;
  private y: SecondaryMotion;
  private z: SecondaryMotion;
  private _result = new THREE.Vector3();

  constructor(config: SecondaryMotionConfig) {
    // Y channel gets gravity; X and Z get zero gravity
    this.x = new SecondaryMotion({ ...config, gravity: 0 });
    this.y = new SecondaryMotion(config);
    this.z = new SecondaryMotion({ ...config, gravity: 0 });
  }

  setStart(v: THREE.Vector3): void {
    this.x.setStart(v.x);
    this.y.setStart(v.y);
    this.z.setStart(v.z);
  }

  tick(target: THREE.Vector3, dt: number): THREE.Vector3 {
    return this._result.set(
      this.x.tick(target.x, dt),
      this.y.tick(target.y, dt),
      this.z.tick(target.z, dt)
    );
  }

  updateConfig(config: Partial<SecondaryMotionConfig>): void {
    this.x.updateConfig({ ...config, gravity: 0 });
    this.y.updateConfig(config);
    this.z.updateConfig({ ...config, gravity: 0 });
  }
}
