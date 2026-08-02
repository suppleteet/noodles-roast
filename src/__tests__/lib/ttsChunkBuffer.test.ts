import { describe, expect, it } from "vitest";
import { TtsChunkBuffer, isCompleteTtsBuffer } from "@/lib/ttsChunkBuffer";

describe("isCompleteTtsBuffer", () => {
  it("accepts a finalized line with audio", () => {
    const buffer = new TtsChunkBuffer();
    buffer.push("pcm");
    buffer.finish();

    expect(isCompleteTtsBuffer(buffer)).toBe(true);
  });

  it("rejects partial audio when the stream fails", () => {
    const buffer = new TtsChunkBuffer();
    buffer.push("partial-pcm");
    buffer.finish(true);

    expect(isCompleteTtsBuffer(buffer)).toBe(false);
  });

  it("rejects a nominal completion with no audio", () => {
    const buffer = new TtsChunkBuffer();
    buffer.finish();

    expect(isCompleteTtsBuffer(buffer)).toBe(false);
  });
});
