import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ELEVENLABS_MODEL_ID } from "@/lib/constants";
import { getElevenLabsModelId } from "@/lib/elTtsStream";

describe("ElevenLabs model selection", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to the current low-latency Flash model", () => {
    vi.stubEnv("ELEVENLABS_MODEL_ID", "");
    expect(getElevenLabsModelId()).toBe("eleven_flash_v2_5");
    expect(DEFAULT_ELEVENLABS_MODEL_ID).toBe("eleven_flash_v2_5");
  });

  it("preserves the environment override", () => {
    vi.stubEnv("ELEVENLABS_MODEL_ID", "custom-model");
    expect(getElevenLabsModelId()).toBe("custom-model");
  });
});
