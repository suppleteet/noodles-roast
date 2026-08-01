import { describe, expect, it } from "vitest";
import {
  ROAST_OPENER_SPEED_CAP,
  ROAST_OPENER_STYLE_CAP,
  gainForContinuity,
  voiceSettingsForContinuity,
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

describe("voice continuity", () => {
  const previous = {
    ...DEFAULT_VOICE_SETTINGS,
    stability: 0.42,
    similarity_boost: 0.76,
    style: 0.58,
    speed: 0.91,
  };

  it("inherits the exact prior profile for filler acknowledgements", () => {
    const target = {
      ...DEFAULT_VOICE_SETTINGS,
      stability: 0.8,
      similarity_boost: 0.9,
      style: 0.2,
      speed: 0.7,
    };

    expect(voiceSettingsForContinuity(target, previous, "inherit")).toEqual(previous);
    expect(gainForContinuity(0.55, 0.83, "inherit")).toBe(0.83);
  });

  it("bounds every audible profile jump at the filler-to-joke handoff", () => {
    const target = {
      ...DEFAULT_VOICE_SETTINGS,
      stability: 0.9,
      similarity_boost: 0.95,
      style: 0.1,
      speed: 1.2,
    };
    const next = voiceSettingsForContinuity(target, previous, "smooth");

    expect(Math.abs(next.stability - previous.stability)).toBeCloseTo(0.1);
    expect(Math.abs(next.similarity_boost - previous.similarity_boost)).toBeCloseTo(0.05);
    expect(Math.abs(next.style - previous.style)).toBeCloseTo(0.1);
    expect(Math.abs(next.speed - previous.speed)).toBeCloseTo(0.05);
    expect(gainForContinuity(0.4, 0.85, "smooth")).toBeCloseTo(0.77);
  });
});
