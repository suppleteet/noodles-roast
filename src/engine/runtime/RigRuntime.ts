import * as THREE from "three";
import type { RigConfig, BoneMap, TickContext } from "../types";
import type { ComponentRuntime } from "../components/ComponentRuntime";
import type { GizmoDrawCall } from "../gizmos/types";
import { getComponentType } from "../registry";
import { buildSkeletonGizmos } from "../gizmos/skeletonGizmo";

export class RigRuntime {
  private boneMap: BoneMap = new Map();
  private runtimes: ComponentRuntime[] = [];
  private config: RigConfig | null = null;
  private sceneRoot: THREE.Group;

  constructor(sceneRoot: THREE.Group) {
    this.sceneRoot = sceneRoot;
    this._buildBoneMap();
  }

  private _buildBoneMap(): void {
    this.boneMap = new Map();
    this.sceneRoot.traverse((obj) => {
      if (obj instanceof THREE.Bone) {
        this.boneMap.set(obj.name, obj);
      }
    });
  }

  getBoneNames(): string[] {
    return Array.from(this.boneMap.keys()).sort();
  }

  loadConfig(config: RigConfig): void {
    // Dispose existing runtimes
    for (const rt of this.runtimes) rt.dispose();
    this.runtimes = [];
    this.config = config;

    for (const instance of config.components) {
      const typeDef = getComponentType(instance.type);
      if (!typeDef) {
        console.warn(`[RigRuntime] Unknown component type: "${instance.type}" — skipping`);
        continue;
      }
      const rt = typeDef.createRuntime(instance);
      rt.init(this.boneMap);
      this.runtimes.push(rt);
    }
  }

  tick(dt: number, signals: Record<string, number>): void {
    const ctx: TickContext = { dt, bones: this.boneMap, signals };
    for (let i = 0; i < this.runtimes.length; i++) {
      const instance = this.config?.components[i];
      if (instance?.enabled === false) continue;
      this.runtimes[i].tick(ctx);
    }
  }

  /**
   * Hot-reload config: update in-place where possible, create/remove/reorder as needed.
   */
  updateConfig(newConfig: RigConfig): void {
    const oldMap = new Map(this.runtimes.map((rt, i) => [this.config?.components[i]?.id, rt]));

    this.runtimes = [];
    this.config = newConfig;

    for (const instance of newConfig.components) {
      const existing = oldMap.get(instance.id);
      if (existing) {
        existing.updateConfig(instance.properties);
        this.runtimes.push(existing);
        oldMap.delete(instance.id);
      } else {
        const typeDef = getComponentType(instance.type);
        if (!typeDef) {
          console.warn(`[RigRuntime] Unknown component type: "${instance.type}" — skipping`);
          continue;
        }
        const rt = typeDef.createRuntime(instance);
        rt.init(this.boneMap);
        this.runtimes.push(rt);
      }
    }

    // Dispose removed runtimes
    for (const rt of oldMap.values()) rt.dispose();
  }

  getGizmoDrawCalls(): GizmoDrawCall[] {
    const calls: GizmoDrawCall[] = buildSkeletonGizmos(this.boneMap);
    for (const rt of this.runtimes) {
      if (rt.getGizmos) calls.push(...rt.getGizmos());
    }
    return calls;
  }

  dispose(): void {
    for (const rt of this.runtimes) rt.dispose();
    this.runtimes = [];
    this.boneMap.clear();
  }
}
