import { describe, expect, it } from "vitest";
import { EndSensitivity, StartSensitivity } from "@google/genai";
import { LIVE_REALTIME_INPUT_CONFIG } from "@/lib/liveInputConfig";

describe("LIVE_REALTIME_INPUT_CONFIG", () => {
  it("captures quiet onsets and bounds conversational endpoint latency", () => {
    expect(LIVE_REALTIME_INPUT_CONFIG.automaticActivityDetection).toEqual({
      disabled: false,
      startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
      prefixPaddingMs: 200,
      endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
      silenceDurationMs: 500,
    });
  });
});
