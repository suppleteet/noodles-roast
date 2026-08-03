import { describe, expect, it } from "vitest";
import {
  interruptionTailMs,
  shouldUseMediaElementPlaybackBridge,
  TTS_INTERRUPT_FADE_MS,
} from "@/components/audio/usePcmPlayback";

describe("shouldUseMediaElementPlaybackBridge", () => {
  it("uses direct AudioContext output on desktop Chrome", () => {
    expect(shouldUseMediaElementPlaybackBridge()).toBe(false);
  });

  it("does not reintroduce the live-only Android media element bridge", () => {
    expect(shouldUseMediaElementPlaybackBridge()).toBe(false);
  });
});

describe("interruptionTailMs", () => {
  it("stops immediately when the output envelope is already effectively silent", () => {
    expect(interruptionTailMs(0)).toBe(0);
    expect(interruptionTailMs(0.01)).toBe(0);
  });

  it("bounds an audible interruption to a latency-safe 20ms fade", () => {
    expect(interruptionTailMs(0.0101)).toBe(TTS_INTERRUPT_FADE_MS);
    expect(interruptionTailMs(1)).toBe(20);
    expect(TTS_INTERRUPT_FADE_MS).toBeLessThanOrEqual(20);
  });
});
