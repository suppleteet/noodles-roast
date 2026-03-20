import type { BurnIntensity } from "@/lib/prompts";

// Gemini Live API model — the only model supporting bidirectional audio+video streaming.
// Gemini 3 Flash/Flash-Lite do NOT support Live API (text output only).
export const LIVE_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";

// Voice for the puppet comedian — Kore is theatrical and expressive.
// Alternatives to try: "Charon" (deeper), "Aoede" (warm)
export const LIVE_VOICE_NAME = "Kore";

// Audio format specs required by Gemini Live API
export const MIC_SAMPLE_RATE = 16000; // 16kHz mono PCM input
export const OUTPUT_SAMPLE_RATE = 24000; // 24kHz mono PCM output
export const MIC_MIME_TYPE = "audio/pcm;rate=16000";

// Streaming intervals
export const WEBCAM_SEND_INTERVAL_MS = 1000; // send webcam frame every 1s (max 1fps)
export const AUDIO_CHUNK_DURATION_MS = 100; // send mic audio every 100ms
export const MIC_CHUNK_SAMPLES = MIC_SAMPLE_RATE * (AUDIO_CHUNK_DURATION_MS / 1000); // 1600

// Session rotation — audio+video sessions cap at 2 min.
// Rotate at 90s to allow overlap for seamless handoff.
export const SESSION_ROTATE_MS = 90_000;

// Default burn intensity for live sessions
export const DEFAULT_LIVE_BURN_INTENSITY: BurnIntensity = 3;
