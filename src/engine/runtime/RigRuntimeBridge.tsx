"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useFBX } from "@react-three/drei";
import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { RigConfig } from "../types";
import { RigRuntime } from "./RigRuntime";
import GizmoRenderer from "../gizmos/GizmoRenderer";
import { useRigEditStore } from "../store/RigEditStore";
import type { GizmoDrawCall } from "../gizmos/types";

interface Props {
  config: RigConfig;
  /** Called each frame to get current signal values */
  signalProvider: () => Record<string, number>;
  showGizmos?: boolean;
}

/**
 * R3F component that loads an FBX model, creates a RigRuntime, and ticks
 * it every frame. Passes signal values from the signalProvider into TickContext.
 */
export default function RigRuntimeBridge({ config, signalProvider, showGizmos = false }: Props) {
  const fbx = useFBX(config.modelPath);
  // Clone so multiple instances don't share bone state
  const cloned = useMemo(() => cloneSkeleton(fbx) as THREE.Group, [fbx]);
  const runtimeRef = useRef<RigRuntime | null>(null);
  const gizmoCallsRef = useRef<GizmoDrawCall[]>([]);

  // Initialize runtime once the cloned scene is ready
  useEffect(() => {
    const rt = new RigRuntime(cloned);
    rt.loadConfig(config);
    runtimeRef.current = rt;
    // Expose bone names to edit store for BoneSelector
    useRigEditStore.getState().setBoneNames(rt.getBoneNames());
    return () => {
      rt.dispose();
      runtimeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloned]);

  // Hot-reload config changes
  useEffect(() => {
    runtimeRef.current?.updateConfig(config);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  useFrame((_, delta) => {
    const rt = runtimeRef.current;
    if (!rt) return;
    rt.tick(delta, signalProvider());
    if (showGizmos) gizmoCallsRef.current = rt.getGizmoDrawCalls();
  });

  return (
    <>
      <primitive object={cloned} />
      {showGizmos && <GizmoRenderer drawCalls={gizmoCallsRef.current} />}
    </>
  );
}
