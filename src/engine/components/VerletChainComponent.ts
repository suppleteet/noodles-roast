import * as THREE from "three";
import type { BoneMap, TickContext, ComponentInstance } from "../types";
import type { ComponentRuntime } from "./ComponentRuntime";
import type { GizmoDrawCall } from "../gizmos/types";
import { VerletChain, DEFAULT_VERLET_CONFIG, type VerletChainConfig } from "../simulation/VerletChain";
import { buildVerletGizmos } from "../gizmos/verletGizmo";
import { registerComponentType } from "../registry";
import { createDefaultCurve } from "../animationCurve";

const TYPE = "verletChain";

class VerletChainRuntime implements ComponentRuntime {
  readonly type = TYPE;
  private boneRefs: THREE.Bone[] = [];
  private chain: VerletChain | null = null;
  private restTargets: THREE.Vector3[] = [];
  private props: Record<string, unknown>;
  private _up = new THREE.Vector3(0, 1, 0);
  private _worldToLocal = new THREE.Matrix4();
  private _localPos = new THREE.Vector3();
  private _dir = new THREE.Vector3();
  private _qWorld = new THREE.Quaternion();
  private _parentWorldQ = new THREE.Quaternion();
  private _worldPos = new THREE.Vector3();

  constructor(instance: ComponentInstance) {
    this.props = { ...instance.properties };
  }

  init(bones: BoneMap): void {
    const rootBoneName = this.props.rootBone as string;
    const chainLength = Math.max(1, Math.round(this.props.chainLength as number));

    if (!rootBoneName) return;
    const rootBone = bones.get(rootBoneName);
    if (!rootBone) {
      console.warn(`[VerletChain] Bone not found: "${rootBoneName}"`);
      return;
    }

    // Collect chainLength bones (root + descendants depth-first)
    this.boneRefs = [];
    const collect = (bone: THREE.Bone) => {
      if (this.boneRefs.length >= chainLength) return;
      this.boneRefs.push(bone);
      for (const child of bone.children) {
        if (child instanceof THREE.Bone) { collect(child); break; } // first child only
      }
    };
    collect(rootBone);

    // Snapshot initial world positions
    const initPositions = this.boneRefs.map((b) => {
      const v = new THREE.Vector3();
      b.getWorldPosition(v);
      return v;
    });
    this.restTargets = initPositions.map((p) => p.clone());

    const cfg = this._buildConfig();
    this.chain = new VerletChain(initPositions, cfg);
  }

  tick(ctx: TickContext): void {
    if (!this.chain || this.boneRefs.length === 0) return;

    // Update rest targets from current bone world positions (reuse cached vectors)
    for (let i = 0; i < this.boneRefs.length; i++) {
      this.boneRefs[i].getWorldPosition(this.restTargets[i]);
    }

    this.chain.pinRoot(this.restTargets[0]);
    this.chain.step(ctx.dt, this.restTargets);

    // Write positions back to bones
    for (let i = 0; i < this.boneRefs.length; i++) {
      const bone = this.boneRefs[i];
      const simPos = this.chain.positions[i];

      // Set world position via parent's inverse world matrix
      if (bone.parent) {
        this._worldToLocal.copy(bone.parent.matrixWorld).invert();
        this._localPos.copy(simPos).applyMatrix4(this._worldToLocal);
        bone.position.copy(this._localPos);
      }

      // Derive rotation to point toward next bone
      if (i < this.boneRefs.length - 1) {
        const nextSimPos = this.chain.positions[i + 1];
        this._dir.copy(nextSimPos).sub(simPos).normalize();
        if (this._dir.length() > 0.001) {
          this._qWorld.setFromUnitVectors(this._up, this._dir);
          // Convert to local space
          if (bone.parent) bone.parent.getWorldQuaternion(this._parentWorldQ);
          else this._parentWorldQ.identity();
          bone.quaternion.copy(this._parentWorldQ.invert().multiply(this._qWorld));
        }
      }

      bone.updateMatrixWorld(true);
    }
  }

  updateConfig(properties: Record<string, unknown>): void {
    this.props = { ...properties };
    this.chain?.updateConfig(this._buildConfig());
  }

  getGizmos(): GizmoDrawCall[] {
    if (!this.chain) return [];
    return buildVerletGizmos(this.chain.positions, this.restTargets);
  }

  dispose(): void {
    this.chain = null;
    this.boneRefs = [];
  }

  private _buildConfig(): VerletChainConfig {
    const g = (this.props.gravity as [number, number, number]) ?? DEFAULT_VERLET_CONFIG.gravity;
    return {
      gravity: g,
      damping: (this.props.damping as number) ?? DEFAULT_VERLET_CONFIG.damping,
      structuralStiffness: (this.props.structuralStiffness as number) ?? DEFAULT_VERLET_CONFIG.structuralStiffness,
      attachmentStiffness: (this.props.attachmentStiffness as number) ?? DEFAULT_VERLET_CONFIG.attachmentStiffness,
      constraintIterations: Math.round((this.props.constraintIterations as number) ?? DEFAULT_VERLET_CONFIG.constraintIterations),
      maxStretch: (this.props.maxStretch as number) ?? DEFAULT_VERLET_CONFIG.maxStretch,
    };
  }
}

// ── Register ──────────────────────────────────────────────────────────────────

registerComponentType({
  type: TYPE,
  label: "Verlet Chain",
  category: "simulation",
  signals: [], // no external signals — purely physics-driven
  propertyDefs: [
    { key: "rootBone", label: "Root Bone", type: "string", bone: true, default: "" },
    { key: "chainLength", label: "Chain Length", type: "float", min: 1, max: 20, step: 1, default: 3 },
    { key: "gravity", label: "Gravity", type: "vec3", min: -20, max: 20, default: [0, -9.8, 0] },
    { key: "damping", label: "Damping", type: "float", min: 0, max: 1, step: 0.01, default: 0.95 },
    { key: "structuralStiffness", label: "Structural Stiffness", type: "float", min: 0, max: 1, step: 0.01, default: 0.8 },
    { key: "attachmentStiffness", label: "Attachment Stiffness", type: "float", min: 0, max: 1, step: 0.01, default: 0.3 },
    { key: "constraintIterations", label: "Constraint Iterations", type: "float", min: 1, max: 10, step: 1, default: 3 },
    { key: "maxStretch", label: "Max Stretch", type: "float", min: 1, max: 3, step: 0.05, default: 1.2 },
  ],
  createRuntime: (instance) => new VerletChainRuntime(instance),
});

// Export dummy to trigger import side-effect (registration)
export const _verletChainRegistered = true;

// Suppress unused import warning
void createDefaultCurve;
