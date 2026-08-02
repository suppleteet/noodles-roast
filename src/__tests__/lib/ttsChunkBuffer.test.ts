import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TtsChunkBuffer,
  armTtsStreamWatchdog,
  isCompleteTtsBuffer,
} from "@/lib/ttsChunkBuffer";

afterEach(() => {
  vi.useRealTimers();
});

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

  it("keeps a failed timeout final even if a late producer reports success", () => {
    const buffer = new TtsChunkBuffer();
    buffer.finish(true);
    buffer.push("late-pcm");
    buffer.finish(false);

    expect(buffer.chunks).toEqual([]);
    expect(buffer.failed).toBe(true);
  });
});

describe("armTtsStreamWatchdog", () => {
  it("fails and releases a stream with no first audio", async () => {
    vi.useFakeTimers();
    const buffer = new TtsChunkBuffer();
    const abort = vi.fn();
    const onTimeout = vi.fn();
    const waiting = buffer.waitForUpdate();
    armTtsStreamWatchdog(buffer, abort, {
      firstAudioMs: 2200,
      completionMs: 7000,
      onTimeout,
    });

    await vi.advanceTimersByTimeAsync(2200);
    await waiting;

    expect(abort).toHaveBeenCalledOnce();
    expect(onTimeout).toHaveBeenCalledWith("first-audio");
    expect(buffer).toMatchObject({ done: true, failed: true });
  });

  it("clears the first-audio timer but still bounds completion", async () => {
    vi.useFakeTimers();
    const buffer = new TtsChunkBuffer();
    const abort = vi.fn();
    const onTimeout = vi.fn();
    const watchdog = armTtsStreamWatchdog(buffer, abort, {
      firstAudioMs: 2200,
      completionMs: 7000,
      onTimeout,
    });

    watchdog.noteFirstAudio();
    buffer.push("pcm");
    await vi.advanceTimersByTimeAsync(2200);
    expect(onTimeout).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(4800);
    expect(onTimeout).toHaveBeenCalledWith("completion");
    expect(buffer.failed).toBe(true);
  });
});
