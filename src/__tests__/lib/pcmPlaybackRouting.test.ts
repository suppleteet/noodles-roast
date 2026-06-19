import { describe, expect, it } from "vitest";
import { shouldUseMediaElementPlaybackBridge } from "@/components/audio/usePcmPlayback";

describe("shouldUseMediaElementPlaybackBridge", () => {
  it("uses direct AudioContext output on desktop Chrome", () => {
    expect(
      shouldUseMediaElementPlaybackBridge(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149.0.0.0 Safari/537.36",
      ),
    ).toBe(false);
  });

  it("keeps the media element bridge on Android Chrome", () => {
    expect(
      shouldUseMediaElementPlaybackBridge(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/149.0.0.0 Mobile Safari/537.36",
      ),
    ).toBe(true);
  });
});
