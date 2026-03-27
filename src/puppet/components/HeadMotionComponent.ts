import * as THREE from "three";
import { createNoise3D } from "simplex-noise";
import type { BoneMap, TickContext, ComponentInstance, SecondaryMotionConfig } from "@/engine/types";
import type { ComponentRuntime } from "@/engine/components/ComponentRuntime";
import { SecondaryMotion } from "@/engine/secondary/SecondaryMotion";
import { registerComponentType } from "@/engine/registry";
import { DEFAULT_SECONDARY_MOTION_CONFIG } from "@/engine/types";

const TYPE = "headMotion";

const DEFAULT_SECONDARY: SecondaryMotionConfig = {
  ...DEFAULT_SECONDARY_MOTION_CONFIG,
  mode: "spring",
  weight: 0.6,
  stiffness: 40,
  damping: 10,
};

class HeadMotionRuntime implements ComponentRuntime {
  readonly type = TYPE;
  private headBone: THREE.Bone | null = null;
  private pitchSM: SecondaryMotion;
  private yawSM: SecondaryMotion;
  private rollSM: SecondaryMotion;
  private noise3D: (x: number, y: number, z: number) => number;
  private time: number = 0;
  private props: Record<string, unknown>;

  constructor(instance: ComponentInstance) {
    this.props = { ...instance.properties };
    this.noise3D = createNoise3D();
    const cfg = (this.props.secondary as SecondaryMotionConfig) ?? DEFAULT_SECONDARY;
    this.pitchSM = new SecondaryMotion(cfg);
    this.yawSM = new SecondaryMotion(cfg);
    this.rollSM = new SecondaryMotion(cfg);
  }

  init(bones: BoneMap): void {
    this.headBone = bones.get(this.props.headBone as string) ?? null;
    if (!this.headBone) console.warn(`[HeadMotion] headBone not found: "${this.props.headBone}"`);
  }

  tick(ctx: TickContext): void {
    if (!this.headBone) return;

    this.time += ctx.dt;
    const t = this.time;
    const amp = ctx.signals.audioAmplitude ?? 0;
    const speed = (this.props.noiseSpeed as number) ?? 0.4;
    const excitement = (this.props.excitementScale as number) ?? 0.3;

    const excitementFactor = 1 + amp * excitement;

    // Sample noise per axis with offset seeds
    const pitchNoise = this.noise3D(t * speed, 0, 0);
    const yawNoise = this.noise3D(t * speed, 10, 0);
    const rollNoise = this.noise3D(t * speed, 20, 0);

    const pitchMin = (this.props.pitchMin as number) ?? -0.08;
    const pitchMax = (this.props.pitchMax as number) ?? 0.12;
    const yawMin = (this.props.yawMin as number) ?? -0.15;
    const yawMax = (this.props.yawMax as number) ?? 0.15;
    const rollMin = (this.props.rollMin as number) ?? -0.05;
    const rollMax = (this.props.rollMax as number) ?? 0.05;

    // Map noise [-1, 1] → [min, max], scale by excitement
    const mapNoise = (n: number, min: number, max: number) => {
      const center = (min + max) / 2;
      const halfRange = (max - min) / 2;
      return center + n * halfRange * excitementFactor;
    };

    const targetPitch = mapNoise(pitchNoise, pitchMin, pitchMax);
    const targetYaw = mapNoise(yawNoise, yawMin, yawMax);
    const targetRoll = mapNoise(rollNoise, rollMin, rollMax);

    const pitch = this.pitchSM.tick(targetPitch, ctx.dt);
    const yaw = this.yawSM.tick(targetYaw, ctx.dt);
    const roll = this.rollSM.tick(targetRoll, ctx.dt);

    this.headBone.rotation.set(pitch, yaw, roll);
  }

  updateConfig(properties: Record<string, unknown>): void {
    this.props = { ...properties };
    const cfg = (this.props.secondary as SecondaryMotionConfig) ?? DEFAULT_SECONDARY;
    this.pitchSM.updateConfig(cfg);
    this.yawSM.updateConfig(cfg);
    this.rollSM.updateConfig(cfg);
  }

  dispose(): void {
    this.headBone = null;
  }
}

// ── Register ──────────────────────────────────────────────────────────────────

registerComponentType({
  type: TYPE,
  label: "Head Motion",
  category: "motion",
  signals: [
    { key: "audioAmplitude", label: "Audio Amplitude", min: 0, max: 1, default: 0 },
  ],
  propertyDefs: [
    { key: "headBone", label: "Head Bone", type: "string", bone: true, default: "" },
    { key: "pitchMin", label: "Pitch Min (rad)", type: "float", min: -1, max: 0, step: 0.01, default: -0.08 },
    { key: "pitchMax", label: "Pitch Max (rad)", type: "float", min: 0, max: 1, step: 0.01, default: 0.12 },
    { key: "yawMin", label: "Yaw Min (rad)", type: "float", min: -1, max: 0, step: 0.01, default: -0.15 },
    { key: "yawMax", label: "Yaw Max (rad)", type: "float", min: 0, max: 1, step: 0.01, default: 0.15 },
    { key: "rollMin", label: "Roll Min (rad)", type: "float", min: -0.5, max: 0, step: 0.01, default: -0.05 },
    { key: "rollMax", label: "Roll Max (rad)", type: "float", min: 0, max: 0.5, step: 0.01, default: 0.05 },
    { key: "noiseSpeed", label: "Noise Speed", type: "float", min: 0, max: 5, step: 0.05, default: 0.4 },
    { key: "excitementScale", label: "Excitement Scale", type: "float", min: 0, max: 2, step: 0.05, default: 0.3 },
    { key: "secondary", label: "Secondary Motion", type: "secondaryMotion", default: DEFAULT_SECONDARY },
  ],
  createRuntime: (instance) => new HeadMotionRuntime(instance),
});

export const _headMotionRegistered = true;
