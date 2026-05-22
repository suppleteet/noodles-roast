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
    this.chunks.push(chunk);
    this.notify();
  }

  finish(failed = false): void {
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
