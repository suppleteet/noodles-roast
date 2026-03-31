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
 * Also manages AnimationMixer for FBX animation clip playback.
 */
export default function RigRuntimeBridge({ config, signalProvider, showGizmos = false }: Props) {
  const fbx = useFBX(config.modelPath);
  // Clone so multiple instances don't share bone state
  const cloned = useMemo(() => cloneSkeleton(fbx) as THREE.Group, [fbx]);
  const runtimeRef = useRef<RigRuntime | null>(null);
  const gizmoCallsRef = useRef<GizmoDrawCall[]>([]);

  // Animation mixer + clips
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const clipsRef = useRef<THREE.AnimationClip[]>([]);
  const activeActionRef = useRef<THREE.AnimationAction | null>(null);
  const prevPlayingRef = useRef<string | null>(null);

  // Initialize runtime + extract animation clips
  useEffect(() => {
    const rt = new RigRuntime(cloned);
    rt.loadConfig(config);
    runtimeRef.current = rt;

    // Expose bone names
    useRigEditStore.getState().setBoneNames(rt.getBoneNames());

    // Extract animation clips from the FBX
    const clips = fbx.animations ?? [];
    clipsRef.current = clips;
    const clipNames = clips.map((c) => c.name || `Clip ${clips.indexOf(c)}`);
    useRigEditStore.getState().setAnimationClipNames(clipNames);

    // Create mixer on the cloned scene
    const mixer = new THREE.AnimationMixer(cloned);
    mixerRef.current = mixer;

    return () => {
      rt.dispose();
      runtimeRef.current = null;
      mixer.stopAllAction();
      mixerRef.current = null;
      activeActionRef.current = null;
      prevPlayingRef.current = null;
      useRigEditStore.getState().setAnimationClipNames([]);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloned, fbx]);

  // Hot-reload config changes
  useEffect(() => {
    runtimeRef.current?.updateConfig(config);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  useFrame((_, delta) => {
    const rt = runtimeRef.current;
    const mixer = mixerRef.current;

    // Handle play/stop from store
    const { playingClipName } = useRigEditStore.getState();
    if (playingClipName !== prevPlayingRef.current) {
      prevPlayingRef.current = playingClipName;

      if (activeActionRef.current) {
        activeActionRef.current.stop();
        activeActionRef.current = null;
      }

      if (playingClipName && mixer) {
        const clip = clipsRef.current.find(
          (c) => c.name === playingClipName || `Clip ${clipsRef.current.indexOf(c)}` === playingClipName,
        );
        if (clip) {
          const action = mixer.clipAction(clip);
          action.reset().play();
          activeActionRef.current = action;
        }
      }
    }

    // Tick animation mixer (drives bone targets)
    if (mixer) mixer.update(delta);

    // Tick rig runtime (secondary motion follows bone targets)
    if (rt) {
      rt.tick(delta, signalProvider());
      if (showGizmos) gizmoCallsRef.current = rt.getGizmoDrawCalls();
    }
  });

  return (
    <>
      <primitive object={cloned} />
      {showGizmos && <GizmoRenderer drawCalls={gizmoCallsRef.current} />}
    </>
  );
}
