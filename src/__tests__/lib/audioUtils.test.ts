import { describe, it, expect } from "vitest";
import {
  float32ToBase64Pcm16,
  base64Pcm16ToFloat32,
  levelMicrophonePcm,
  pcmToAudioBuffer,
} from "@/lib/audioUtils";

describe("float32ToBase64Pcm16", () => {
  it("converts silence (zeros) to base64", () => {
    const input = new Float32Array([0, 0, 0, 0]);
    const result = float32ToBase64Pcm16(input);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("handles max positive value", () => {
    const input = new Float32Array([1.0]);
    const base64 = float32ToBase64Pcm16(input);
    const roundTrip = base64Pcm16ToFloat32(base64);
    expect(roundTrip[0]).toBeCloseTo(1.0, 3);
  });

  it("handles max negative value", () => {
    const input = new Float32Array([-1.0]);
    const base64 = float32ToBase64Pcm16(input);
    const roundTrip = base64Pcm16ToFloat32(base64);
    expect(roundTrip[0]).toBeCloseTo(-1.0, 3);
  });

  it("clamps values beyond -1..1", () => {
    const input = new Float32Array([2.0, -2.0]);
    const base64 = float32ToBase64Pcm16(input);
    const roundTrip = base64Pcm16ToFloat32(base64);
    expect(roundTrip[0]).toBeCloseTo(1.0, 3);
    expect(roundTrip[1]).toBeCloseTo(-1.0, 3);
  });
});

describe("levelMicrophonePcm", () => {
  it("boosts a quiet signal toward the recognizer target", () => {
    const input = new Float32Array([0.005, -0.005, 0.005, -0.005]);
    const result = levelMicrophonePcm(input, { previousGain: 5 });

    expect(result.gain).toBe(5);
    expect(result.outputRms).toBeCloseTo(0.025, 4);
  });

  it("backs off fixed gain for a close speaker without clipping peaks", () => {
    const input = new Float32Array([0.6, -0.6, 0.2, -0.2]);
    const result = levelMicrophonePcm(input, { previousGain: 5 });

    expect(result.gain).toBeLessThan(2);
    expect(result.peak).toBeLessThanOrEqual(0.95);
    expect(Array.from(result.pcm).some((sample) => Math.abs(sample) < 0.95)).toBe(true);
  });

  it("holds quiet-speech gain through silence for the next onset", () => {
    const result = levelMicrophonePcm(new Float32Array(1600), { previousGain: 5 });
    expect(result.gain).toBe(5);
  });
});

describe("base64Pcm16ToFloat32", () => {
  it("returns empty array for empty base64", () => {
    const result = base64Pcm16ToFloat32(btoa(""));
    expect(result.length).toBe(0);
  });
});

describe("round-trip conversion", () => {
  it("preserves audio data through encode/decode cycle", () => {
    const original = new Float32Array([0, 0.5, -0.5, 0.25, -0.25, 0.75, -0.75]);
    const base64 = float32ToBase64Pcm16(original);
    const decoded = base64Pcm16ToFloat32(base64);

    expect(decoded.length).toBe(original.length);
    for (let i = 0; i < original.length; i++) {
      // Int16 quantization introduces small error (~1/32768)
      expect(decoded[i]).toBeCloseTo(original[i], 3);
    }
  });

  it("handles a larger buffer without errors", () => {
    const original = new Float32Array(1600); // 100ms at 16kHz
    for (let i = 0; i < original.length; i++) {
      original[i] = Math.sin((2 * Math.PI * 440 * i) / 16000); // 440Hz tone
    }
    const base64 = float32ToBase64Pcm16(original);
    const decoded = base64Pcm16ToFloat32(base64);
    expect(decoded.length).toBe(1600);
    // Spot-check a few samples
    expect(decoded[0]).toBeCloseTo(original[0], 3);
    expect(decoded[100]).toBeCloseTo(original[100], 3);
  });
});
