import type * as THREE from "three";

// ── Property system ──────────────────────────────────────────────────────────

export type PropertyType =
  | "float"
  | "bool"
  | "string"
  | "select"
  | "vec3"
  | "curve"
  | "secondaryMotion";

export interface PropertyDef {
  key: string;
  label: string;
  type: PropertyType;
  default: unknown;
  /** float / vec3 */
  min?: number;
  max?: number;
  step?: number;
  /** select */
  options?: { label: string; value: string }[];
  /** string hint — renders BoneSelector UI instead of plain text input */
  bone?: boolean;
}

// ── Signal system ────────────────────────────────────────────────────────────
// Components declare what external signals they read.
// The edit UI auto-generates preview sliders from these declarations.
// The runtime consumer populates signals from whatever source it wants.

export interface SignalDef {
  key: string;
  label: string;
  min: number;
  max: number;
  /** Resting value for edit-mode preview */
  default: number;
}

// ── Component system ─────────────────────────────────────────────────────────

export interface ComponentTypeDef {
  type: string;
  label: string;
  category: "motion" | "simulation" | "constraint";
  propertyDefs: PropertyDef[];
  /** External signals this component reads each tick */
  signals: SignalDef[];
  createRuntime: ComponentRuntimeFactory;
}

export interface ComponentInstance {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  properties: Record<string, unknown>;
}

// ── Rig config ───────────────────────────────────────────────────────────────

export interface RigConfig {
  /** Schema version for future migration */
  _version: number;
  id: string;
  name: string;
  /** Path to .fbx file under /public */
  modelPath: string;
  components: ComponentInstance[];
}

// ── Runtime types ────────────────────────────────────────────────────────────

export type BoneMap = Map<string, THREE.Bone>;

export interface TickContext {
  dt: number;
  bones: BoneMap;
  /**
   * Generic named signal values (e.g. audioAmplitude, motionIntensity).
   * In edit mode these come from preview sliders; in session mode from the
   * session store. Components read from here, never from external stores.
   */
  signals: Record<string, number>;
}

// Imported here to break circular deps — defined in components/ComponentRuntime.ts
// but needed in ComponentTypeDef above.
export type ComponentRuntimeFactory = (instance: ComponentInstance) => import("./components/ComponentRuntime").ComponentRuntime;

// ── Secondary motion config ──────────────────────────────────────────────────

export type SecondaryMotionMode = "none" | "damp" | "spring" | "frameDelay";

export interface SecondaryMotionConfig {
  mode: SecondaryMotionMode;
  /** Blend weight 0–1 (0 = passthrough target, 1 = full secondary) */
  weight: number;
  /** Time constant in seconds — Damp and FrameDelay */
  smoothing: number;
  /** Spring only */
  mass: number;
  stiffness: number;
  damping: number;
  gravity: number;
  /** FrameDelay only */
  delayFrames: number;
}

export const DEFAULT_SECONDARY_MOTION_CONFIG: SecondaryMotionConfig = {
  mode: "none",
  weight: 1,
  smoothing: 0.05,
  mass: 0.5,
  stiffness: 10,
  damping: 5,
  gravity: 0,
  delayFrames: 3,
};

// ── Animation curve ──────────────────────────────────────────────────────────

export interface CurveKeyframe {
  time: number;
  value: number;
  inTangent: number;
  outTangent: number;
}
