/**
 * ElevenLabs WebSocket TTS streaming, server-side only.
 *
 * Opens a WebSocket to ElevenLabs' streaming input API, sends text, and calls
 * `onAudioChunk` with base64 PCM as it arrives.
 */

import WebSocket from "ws";
import {
  DEFAULT_ELEVENLABS_MODEL_ID,
  ELEVENLABS_VOICE_ID,
} from "@/lib/constants";

const EL_OUTPUT_FORMAT = "pcm_24000";
const DEFAULT_CHUNK_LENGTH_SCHEDULE = [120, 160, 250, 290];

export interface ElVoiceSettings {
  stability: number;
  similarity_boost: number;
  style: number;
  speed: number;
  use_speaker_boost: boolean;
}

const DEFAULT_VOICE_SETTINGS: ElVoiceSettings = {
  stability: 0.5,
  similarity_boost: 0.7,
  style: 1,
  speed: 1.0,
  use_speaker_boost: true,
};

interface ElTtsStreamOptions {
  text: string;
  previousText?: string;
  onAudioChunk: (base64Pcm: string) => void;
  onDone: () => void;
  onError: (err: Error) => void;
  voiceId?: string;
  voiceSettings?: Partial<ElVoiceSettings>;
}

export function getElevenLabsModelId(): string {
  return process.env.ELEVENLABS_MODEL_ID?.trim() || DEFAULT_ELEVENLABS_MODEL_ID;
}

function getElevenLabsHost(): string {
  return process.env.ELEVENLABS_API_HOST?.trim() || "api.elevenlabs.io";
}

function shouldUseAutoMode(): boolean {
  return process.env.ELEVENLABS_AUTO_MODE === "true";
}

function getChunkLengthSchedule(): number[] {
  const raw = process.env.ELEVENLABS_CHUNK_SCHEDULE?.trim();
  if (!raw) return DEFAULT_CHUNK_LENGTH_SCHEDULE;
  const parsed = raw
    .split(",")
    .map((n) => Number(n.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  return parsed.length > 0 ? parsed : DEFAULT_CHUNK_LENGTH_SCHEDULE;
}

/**
 * Normalize text at the synthesis boundary. ElevenLabs renders "..." as an
 * actual spoken beat, but reads em/en-dashes as flat micro-pauses (or ignores
 * them) — and LLMs love em-dashes. Replacing here catches every path: LLM
 * output, canned script lines, and prefetched greetings.
 */
export function normalizeTtsText(text: string): string {
  return text.replace(/\s*[—–]+\s*/g, "... ");
}

/**
 * Open an ElevenLabs WebSocket, send text, stream audio back.
 * Returns a cleanup function that closes the connection.
 */
export function streamElTts({
  text,
  previousText,
  onAudioChunk,
  onDone,
  onError,
  voiceId,
  voiceSettings: settingsOverride,
}: ElTtsStreamOptions): () => void {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    onError(new Error("ELEVENLABS_API_KEY not set"));
    return () => {};
  }

  const vid = voiceId ?? process.env.ELEVENLABS_VOICE_ID ?? ELEVENLABS_VOICE_ID;
  const autoMode = shouldUseAutoMode();
  const params = new URLSearchParams({
    model_id: getElevenLabsModelId(),
    output_format: EL_OUTPUT_FORMAT,
    "xi-api-key": apiKey,
  });
  if (autoMode) params.set("auto_mode", "true");

  const ws = new WebSocket(
    `wss://${getElevenLabsHost()}/v1/text-to-speech/${vid}/stream-input?${params.toString()}`,
  );
  let closed = false;

  ws.on("open", () => {
    // ElevenLabs reads `speed` from voice_settings. Putting it under generation_config
    // is silently ignored — keep the full settings object intact.
    const voiceSettings = { ...DEFAULT_VOICE_SETTINGS, ...settingsOverride };
    ws.send(
      JSON.stringify({
        text: " ",
        voice_settings: voiceSettings,
        xi_api_key: apiKey,
        generation_config: {
          chunk_length_schedule: getChunkLengthSchedule(),
        },
        ...(previousText ? { previous_text: previousText } : {}),
      }),
    );

    ws.send(JSON.stringify({ text: normalizeTtsText(text), flush: true }));
    ws.send(JSON.stringify({ text: "" }));
  });

  ws.on("message", (data: WebSocket.Data) => {
    try {
      const msg = JSON.parse(data.toString()) as {
        audio?: string;
        isFinal?: boolean;
        error?: string;
      };

      if (msg.error) {
        closed = true;
        ws.close();
        onError(new Error(`ElevenLabs WS error: ${msg.error}`));
        return;
      }

      if (msg.audio) onAudioChunk(msg.audio);

      if (msg.isFinal) {
        closed = true;
        ws.close();
        onDone();
      }
    } catch {
      // Ignore non-JSON messages.
    }
  });

  ws.on("error", (err: Error) => {
    if (!closed) {
      closed = true;
      onError(err instanceof Error ? err : new Error(String(err)));
    }
  });

  ws.on("close", () => {
    if (!closed) {
      closed = true;
      onDone();
    }
  });

  return () => {
    if (!closed) {
      closed = true;
      try {
        ws.close();
      } catch {
        // noop
      }
    }
  };
}

/**
 * Promise-based wrapper: send text, collect audio chunks via callback,
 * resolve when done. Useful in SSE streaming contexts.
 */
export function streamElTtsAsync(
  text: string,
  onAudioChunk: (base64Pcm: string) => void,
  voiceId?: string,
  previousText?: string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    streamElTts({
      text,
      previousText,
      onAudioChunk,
      onDone: resolve,
      onError: reject,
      voiceId,
    });
  });
}

interface ElTtsIncrementalOptions {
  voiceId?: string;
  voiceSettings?: Partial<ElVoiceSettings>;
  previousText?: string;
  onAudioChunk: (base64Pcm: string) => void;
  onDone: () => void;
  onError: (err: Error) => void;
  /**
   * Override chunk_length_schedule for this stream. Defaults to a more
   * aggressive [60, 100, 160, 220] for incremental streaming so first audio
   * arrives sooner than the single-shot default of [120, 160, 250, 290].
   */
  chunkLengthSchedule?: number[];
}

export interface ElTtsStreamController {
  /** Append text to the open EL WS. Safe to call many times. */
  sendText(delta: string): void;
  /** Signal end-of-input. EL will produce final audio chunks then close. */
  end(): void;
  /** Force-close the stream without waiting for remaining audio (e.g. on cancel). */
  close(): void;
}

const INCREMENTAL_CHUNK_LENGTH_SCHEDULE = [60, 100, 160, 220];

/**
 * Open a long-lived ElevenLabs WebSocket and return a controller for
 * pushing text into it incrementally. Each chunk is sent without `flush`
 * so EL's internal `chunk_length_schedule` controls TTS timing.
 *
 * Voice settings are sent once at handshake and CANNOT be changed mid-stream
 * — that's the architectural reason motion+intensity must be known before
 * calling this function.
 */
export function openElTtsStream({
  voiceId,
  voiceSettings: settingsOverride,
  previousText,
  onAudioChunk,
  onDone,
  onError,
  chunkLengthSchedule,
}: ElTtsIncrementalOptions): ElTtsStreamController {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    onError(new Error("ELEVENLABS_API_KEY not set"));
    return { sendText: () => {}, end: () => {}, close: () => {} };
  }

  const vid = voiceId ?? process.env.ELEVENLABS_VOICE_ID ?? ELEVENLABS_VOICE_ID;
  const autoMode = shouldUseAutoMode();
  const params = new URLSearchParams({
    model_id: getElevenLabsModelId(),
    output_format: EL_OUTPUT_FORMAT,
    "xi-api-key": apiKey,
  });
  if (autoMode) params.set("auto_mode", "true");

  const ws = new WebSocket(
    `wss://${getElevenLabsHost()}/v1/text-to-speech/${vid}/stream-input?${params.toString()}`,
  );
  let closed = false;
  let opened = false;
  let pendingText = "";
  let endRequested = false;

  ws.on("open", () => {
    opened = true;
    const voiceSettings = { ...DEFAULT_VOICE_SETTINGS, ...settingsOverride };
    ws.send(
      JSON.stringify({
        text: " ",
        voice_settings: voiceSettings,
        xi_api_key: apiKey,
        generation_config: {
          chunk_length_schedule: chunkLengthSchedule ?? INCREMENTAL_CHUNK_LENGTH_SCHEDULE,
        },
        ...(previousText ? { previous_text: previousText } : {}),
      }),
    );

    if (pendingText) {
      ws.send(JSON.stringify({ text: normalizeTtsText(pendingText) }));
      pendingText = "";
    }
    if (endRequested) {
      ws.send(JSON.stringify({ text: "" }));
    }
  });

  ws.on("message", (data: WebSocket.Data) => {
    try {
      const msg = JSON.parse(data.toString()) as {
        audio?: string;
        isFinal?: boolean;
        error?: string;
      };

      if (msg.error) {
        closed = true;
        ws.close();
        onError(new Error(`ElevenLabs WS error: ${msg.error}`));
        return;
      }

      if (msg.audio) onAudioChunk(msg.audio);

      if (msg.isFinal) {
        closed = true;
        ws.close();
        onDone();
      }
    } catch {
      // Ignore non-JSON messages.
    }
  });

  ws.on("error", (err: Error) => {
    if (!closed) {
      closed = true;
      onError(err instanceof Error ? err : new Error(String(err)));
    }
  });

  ws.on("close", () => {
    if (!closed) {
      closed = true;
      onDone();
    }
  });

  return {
    sendText(delta: string) {
      if (closed || !delta) return;
      if (!opened) {
        // Buffer until handshake completes.
        pendingText += delta;
        return;
      }
      // Em-dash is a single char, so per-delta normalization can't split one.
      ws.send(JSON.stringify({ text: normalizeTtsText(delta) }));
    },
    end() {
      if (closed) return;
      if (!opened) {
        endRequested = true;
        return;
      }
      // Empty-text terminator signals EOI to ElevenLabs.
      ws.send(JSON.stringify({ text: "" }));
    },
    close() {
      if (!closed) {
        closed = true;
        try {
          ws.close();
        } catch {
          // noop
        }
      }
    },
  };
}
