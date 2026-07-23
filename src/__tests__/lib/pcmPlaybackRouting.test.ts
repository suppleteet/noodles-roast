import { describe, expect, it } from "vitest";
import { shouldUseMediaElementPlaybackBridge } from "@/components/audio/usePcmPlayback";

describe("shouldUseMediaElementPlaybackBridge", () => {
  it("uses direct AudioContext output on desktop Chrome", () => {
    expect(shouldUseMediaElementPlaybackBridge()).toBe(false);
  });

  it("does not reintroduce the live-only Android media element bridge", () => {
    expect(shouldUseMediaElementPlaybackBridge()).toBe(false);
  });
});
