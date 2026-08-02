/**
 * A growable list of base64 PCM audio chunks consumed by the PCM playback
 * pipeline. Producers push chunks as they arrive (from /api/tts-ws SSE or
 * /api/generate-speak streaming) and call finish() once the source is done.
 * Consumers use waitForUpdate() to await the next chunk or completion.
 *
 * Extracted from LiveSessionController so the greeting prefetch can fill a
 * buffer up-front and hand it to the brain when the session starts.
 */
export class TtsChunkBuffer {
  chunks: string[] = [];
  done = false;
  failed = false;
  private waiters: Array<() => void> = [];

  push(chunk: string): void {
    if (this.done) return;
    this.chunks.push(chunk);
    this.notify();
  }

  finish(failed = false): void {
    if (this.done) return;
    this.failed = failed;
    this.done = true;
    this.notify();
  }

  waitForUpdate(): Promise<void> {
    if (this.done) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private notify(): void {
    const waiters = this.waiters.splice(0);
    for (const resolve of waiters) resolve();
  }
}

/** A line is playable only after the producer finalized every chunk cleanly.
 * Partial failed streams are intentionally rejected so the caller can replace
 * the entire line through an independent transport without repeating a prefix. */
export function isCompleteTtsBuffer(buffer: TtsChunkBuffer): boolean {
  return buffer.done && !buffer.failed && buffer.chunks.length > 0;
}

export type TtsStreamTimeoutReason = "first-audio" | "completion";

export interface TtsStreamWatchdog {
  noteFirstAudio(): void;
  dispose(): void;
}

/**
 * Put a finite bound around a streamed TTS transaction. Playback waits for a
 * complete buffer before enqueueing, so marking a timeout failed is safe: no
 * partial prefix has played and the caller can retry the whole line via REST.
 */
export function armTtsStreamWatchdog(
  buffer: TtsChunkBuffer,
  abort: () => void,
  options: {
    firstAudioMs: number;
    completionMs: number;
    onTimeout?: (reason: TtsStreamTimeoutReason) => void;
  },
): TtsStreamWatchdog {
  let disposed = false;
  let firstAudioSeen = false;
  let firstAudioTimer: ReturnType<typeof setTimeout> | null = null;
  let completionTimer: ReturnType<typeof setTimeout> | null = null;

  const clear = () => {
    if (firstAudioTimer) clearTimeout(firstAudioTimer);
    if (completionTimer) clearTimeout(completionTimer);
    firstAudioTimer = null;
    completionTimer = null;
  };
  const fail = (reason: TtsStreamTimeoutReason) => {
    if (disposed || buffer.done) return;
    disposed = true;
    clear();
    abort();
    buffer.finish(true);
    options.onTimeout?.(reason);
  };

  firstAudioTimer = setTimeout(() => fail("first-audio"), options.firstAudioMs);
  completionTimer = setTimeout(() => fail("completion"), options.completionMs);

  return {
    noteFirstAudio() {
      if (disposed || firstAudioSeen) return;
      firstAudioSeen = true;
      if (firstAudioTimer) clearTimeout(firstAudioTimer);
      firstAudioTimer = null;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clear();
    },
  };
}
