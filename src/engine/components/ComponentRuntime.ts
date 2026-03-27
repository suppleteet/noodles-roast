import type { BoneMap, TickContext } from "../types";
import type { GizmoDrawCall } from "../gizmos/types";

export interface ComponentRuntime {
  readonly type: string;
  init(bones: BoneMap): void;
  tick(ctx: TickContext): void;
  updateConfig(properties: Record<string, unknown>): void;
  getGizmos?(): GizmoDrawCall[];
  dispose(): void;
}

export type ComponentRuntimeFactory = (
  instance: import("../types").ComponentInstance
) => ComponentRuntime;
