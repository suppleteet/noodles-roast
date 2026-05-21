/**
 * Motion-driven voice setting deltas for ElevenLabs TTS.
 *
 * The brain emits a `motion` + `intensity` with each `queueSpeak()` to drive
 * puppet animation. We piggyback on it for per-line prosody: each motion maps
 * to small offsets applied on top of the user's base voiceSettings, with
 * `intensity` scaling how strongly the delta is applied.
 *
 * Keep deltas conservative — large stability/style swings make the voice
 * sound like a different person between lines.
 */

import type { VoiceSettings } from "@/store/useSessionStore";
import type { MotionState } from "@/lib/stateMachine";

/**
 * Per-motion offsets. Each value is ADDED to the base setting before clamping.
 * `null` means no offset.
 */
interface VoiceDelta {
  stability?: number;
  style?: number;
  speed?: number;
}

const MOTION_DELTAS: Record<MotionState, VoiceDelta> = {
  // Drier, slightly slower — sneer / sarcasm.
  smug: { stability: -0.15, style: -0.05, speed: -0.05 },
  // Lower & quieter — like leaning in to share a secret.
  conspiratorial: { stability: -0.2, style: -0.05, speed: -0.08 },
  // Surprised — quicker, more expressive.
  shocked: { stability: -0.25, style: 0, speed: 0.08 },
  // Punchy delivery — emphasis on the key word.
  emphasis: { stability: -0.1, style: 0, speed: -0.02 },
  // High energy — fast & expressive.
  energetic: { stability: -0.2, style: 0, speed: 0.06 },
  // Big laugh — least stable, fastest.
  laugh: { stability: -0.3, style: 0, speed: 0.04 },
  // Pondering — softer, slower, more controlled.
  thinking: { stability: 0.08, style: -0.1, speed: -0.06 },
  // Passive / neutral.
  listening: {},
  idle: {},
  sleeping: { stability: 0.1, style: -0.1, speed: -0.1 },
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Apply a motion-based delta to base voice settings.
 * `intensity` (0-1) scales how strongly the delta is applied — 1.0 = full delta,
 * 0.5 = half, 0 = unchanged.
 */
export function voiceSettingsForMotion(
  base: VoiceSettings,
  motion?: MotionState,
  intensity = 0.7,
): VoiceSettings {
  if (!motion) return base;
  const delta = MOTION_DELTAS[motion];
  if (!delta) return base;
  const i = clamp(intensity, 0, 1);
  return {
    ...base,
    stability: clamp(base.stability + (delta.stability ?? 0) * i, 0, 1),
    style: clamp(base.style + (delta.style ?? 0) * i, 0, 1),
    speed: clamp(base.speed + (delta.speed ?? 0) * i, 0.7, 1.2),
  };
}
