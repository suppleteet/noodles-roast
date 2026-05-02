/**
 * ElevenLabs WebSocket TTS streaming, server-side only.
 *
 * Opens a WebSocket to ElevenLabs' streaming input API, sends text, and calls
 * `onAudioChunk` with base64 PCM as it arrives.
 */

import WebSocket from "ws";
import { ELEVENLABS_VOICE_ID } from "@/lib/constants";

const DEFAULT_EL_MODEL_ID = "eleven_turbo_v2_5";
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
  stability: 0.72,
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
  return process.env.ELEVENLABS_MODEL_ID?.trim() || DEFAULT_EL_MODEL_ID;
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

    ws.send(JSON.stringify({ text, flush: true }));
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
