import { describe, expect, it } from "vitest";
import {
  containRecordingRect,
  coverSourceRect,
  mapElementToRecording,
  recordingSizeForFrame,
} from "@/lib/recordingLayout";

describe("recording layout", () => {
  it("preserves portrait, handset, and landscape call-frame ratios with even dimensions", () => {
    expect(recordingSizeForFrame(390, 844)).toEqual({ width: 592, height: 1280 });
    expect(recordingSizeForFrame(440, 880)).toEqual({ width: 640, height: 1280 });
    expect(recordingSizeForFrame(844, 390)).toEqual({ width: 1280, height: 592 });
  });

  it("contains a rotated call without stretching the frozen encoder frame", () => {
    const rect = containRecordingRect(844, 390, 592, 1280);
    expect(rect.x).toBe(0);
    expect(rect.y).toBeCloseTo(503.223, 2);
    expect(rect.width).toBe(592);
    expect(rect.height).toBeCloseTo(273.555, 2);
  });

  it("maps the live top-right self-view into recording coordinates", () => {
    const rect = mapElementToRecording(
      { x: 20, y: 10, width: 390, height: 844 },
      { x: 292, y: 78, width: 104, height: 138.667 },
      { x: 0, y: 0, width: 592, height: 1280 },
    );
    expect(rect.x).toBeCloseTo(412.882, 2);
    expect(rect.y).toBeCloseTo(103.128, 2);
    expect(rect.width).toBeCloseTo(157.867, 2);
    expect(rect.height).toBeCloseTo(210.301, 2);
  });

  it("uses the same centered cover crop as the live self-view", () => {
    const landscape = coverSourceRect(1920, 1080, 104, 138.667);
    expect(landscape.x).toBeCloseTo(555.001, 2);
    expect(landscape.y).toBe(0);
    expect(landscape.width).toBeCloseTo(809.998, 2);
    expect(landscape.height).toBe(1080);
    expect(coverSourceRect(1080, 1920, 124, 93)).toEqual({
      x: 0,
      y: 555,
      width: 1080,
      height: 810,
    });
  });
});
