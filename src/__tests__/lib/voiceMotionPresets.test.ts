import { describe, expect, it } from "vitest";
import {
  ROAST_OPENER_SPEED_CAP,
  ROAST_OPENER_STYLE_CAP,
  voiceSettingsForMotion,
  voiceSettingsForRoastOpener,
} from "@/lib/voiceMotionPresets";
import { DEFAULT_VOICE_SETTINGS } from "@/store/useSessionStore";

describe("voiceSettingsForRoastOpener", () => {
  it("caps final style and speed after motion deltas", () => {
    const motion = "deadpan";
    const intensity = 0.6;
    const motionOnly = voiceSettingsForMotion(DEFAULT_VOICE_SETTINGS, motion, intensity);
    const opener = voiceSettingsForRoastOpener(DEFAULT_VOICE_SETTINGS, motion, intensity);

    expect(motionOnly.style).toBeGreaterThan(ROAST_OPENER_STYLE_CAP);
    expect(motionOnly.speed).toBeGreaterThan(ROAST_OPENER_SPEED_CAP);
    expect(opener.style).toBe(ROAST_OPENER_STYLE_CAP);
    expect(opener.speed).toBe(ROAST_OPENER_SPEED_CAP);
    expect(opener.stability).toBeCloseTo(motionOnly.stability);
    expect(opener.similarity_boost).toBe(DEFAULT_VOICE_SETTINGS.similarity_boost);
  });

  it("preserves quieter user overrides below the opener caps", () => {
    const opener = voiceSettingsForRoastOpener(
      { ...DEFAULT_VOICE_SETTINGS, style: 0.1, speed: 0.8 },
      "thinking",
      0.6,
    );

    expect(opener.style).toBeLessThanOrEqual(ROAST_OPENER_STYLE_CAP);
    expect(opener.speed).toBeLessThanOrEqual(0.8);
  });
});
