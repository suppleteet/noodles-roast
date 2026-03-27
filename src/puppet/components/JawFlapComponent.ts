import * as THREE from "three";
import type { BoneMap, TickContext, ComponentInstance, SecondaryMotionConfig } from "@/engine/types";
import type { ComponentRuntime } from "@/engine/components/ComponentRuntime";
import { SecondaryMotion } from "@/engine/secondary/SecondaryMotion";
import { evaluateCurve, createDefaultCurve } from "@/engine/animationCurve";
import { registerComponentType } from "@/engine/registry";
import { DEFAULT_SECONDARY_MOTION_CONFIG } from "@/engine/types";
import type { CurveKeyframe } from "@/engine/types";

const TYPE = "jawFlap";

const DEFAULT_SECONDARY: SecondaryMotionConfig = {
  ...DEFAULT_SECONDARY_MOTION_CONFIG,
  mode: "damp",
  weight: 0.8,
  smoothing: 0.04,
};

class JawFlapRuntime implements ComponentRuntime {
  readonly type = TYPE;
  private topBone: THREE.Bone | null = null;
  private bottomBone: THREE.Bone | null = null;
  private secondary: SecondaryMotion;
  private props: Record<string, unknown>;

  constructor(instance: ComponentInstance) {
    this.props = { ...instance.properties };
    const cfg = (this.props.secondary as SecondaryMotionConfig) ?? DEFAULT_SECONDARY;
    this.secondary = new SecondaryMotion(cfg);
  }

  init(bones: BoneMap): void {
    this.topBone = bones.get(this.props.topBone as string) ?? null;
    this.bottomBone = bones.get(this.props.bottomBone as string) ?? null;
    if (!this.topBone) console.warn(`[JawFlap] topBone not found: "${this.props.topBone}"`);
    if (!this.bottomBone) console.warn(`[JawFlap] bottomBone not found: "${this.props.bottomBone}"`);
  }

  tick(ctx: TickContext): void {
    const amp = ctx.signals.audioAmplitude ?? 0;
    const curve = (this.props.responseCurve as CurveKeyframe[]) ?? createDefaultCurve();
    const minAngle = (this.props.minAngle as number) ?? 0;
    const maxAngle = (this.props.maxAngle as number) ?? 0.4;
    const topRatio = (this.props.topRatio as number) ?? 0.4;

    const normalized = evaluateCurve(curve, amp);
    const rawAngle = minAngle + (maxAngle - minAngle) * normalized;
    const angle = this.secondary.tick(rawAngle, ctx.dt);

    const axis = (this.props.axis as string) ?? "x";
    if (this.bottomBone) this.bottomBone.rotation[axis as "x" | "y" | "z"] = angle;
    if (this.topBone) this.topBone.rotation[axis as "x" | "y" | "z"] = -angle * topRatio;
  }

  updateConfig(properties: Record<string, unknown>): void {
    this.props = { ...properties };
    const cfg = (this.props.secondary as SecondaryMotionConfig) ?? DEFAULT_SECONDARY;
    this.secondary.updateConfig(cfg);
  }

  dispose(): void {
    this.topBone = null;
    this.bottomBone = null;
  }
}

// ── Register ──────────────────────────────────────────────────────────────────

registerComponentType({
  type: TYPE,
  label: "Jaw Flap",
  category: "motion",
  signals: [
    { key: "audioAmplitude", label: "Audio Amplitude", min: 0, max: 1, default: 0 },
  ],
  propertyDefs: [
    { key: "topBone", label: "Top Bone", type: "string", bone: true, default: "" },
    { key: "bottomBone", label: "Bottom Bone", type: "string", bone: true, default: "" },
    { key: "axis", label: "Rotation Axis", type: "select", default: "x", options: [
      { label: "X", value: "x" },
      { label: "Y", value: "y" },
      { label: "Z", value: "z" },
    ]},
    { key: "minAngle", label: "Min Angle (rad)", type: "float", min: 0, max: 1, step: 0.01, default: 0 },
    { key: "maxAngle", label: "Max Angle (rad)", type: "float", min: 0, max: 2, step: 0.01, default: 0.4 },
    { key: "topRatio", label: "Top Counter-Rotate Ratio", type: "float", min: 0, max: 1, step: 0.05, default: 0.4 },
    { key: "responseCurve", label: "Response Curve", type: "curve", default: createDefaultCurve() },
    { key: "secondary", label: "Secondary Motion", type: "secondaryMotion", default: DEFAULT_SECONDARY },
  ],
  createRuntime: (instance) => new JawFlapRuntime(instance),
});

export const _jawFlapRegistered = true;
