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

export const ROAST_OPENER_STYLE_CAP = 0.25;
export const ROAST_OPENER_SPEED_CAP = 0.88;

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
  // Drier, slightly slower — superior sneer.
  smug: { stability: -0.15, style: -0.05, speed: -0.06 },
  // Drawn-out, syrupy mock-sincerity — slower and looser than smug so the
  // insincerity is audible, not just implied.
  sarcastic: { stability: -0.28, style: 0.08, speed: -0.1 },
  // Flat, controlled, almost bored — the joke lands BECAUSE nothing in the
  // voice moves. Max stability, minimal style.
  deadpan: { stability: 0.22, style: -0.18, speed: -0.05 },
  // Lower & quieter — like leaning in to share a secret.
  conspiratorial: { stability: -0.22, style: -0.05, speed: -0.1 },
  // Surprised — quicker, more expressive.
  shocked: { stability: -0.3, style: 0.05, speed: 0.1 },
  // Punchy delivery — emphasis on the key word.
  emphasis: { stability: -0.15, style: 0.05, speed: -0.03 },
  // High energy — fast & expressive.
  energetic: { stability: -0.25, style: 0.05, speed: 0.1 },
  // Big laugh — least stable, fastest.
  laugh: { stability: -0.35, style: 0.08, speed: 0.08 },
  // Pondering — softer, slower, more controlled.
  thinking: { stability: 0.08, style: -0.1, speed: -0.06 },
  // Passive / neutral.
  listening: {},
  idle: {},
  sleeping: { stability: 0.1, style: -0.1, speed: -0.1 },
};

/**
 * Per-motion playback gain — cheap "volume direction" the TTS API can't
 * express. Duck-only (≤ 1.0): quiet lean-ins create the dynamic contrast,
 * and never boosting means hot EL peaks can't clip the recording path
 * (which bypasses the master playback cap). Applied per chunk at schedule time.
 */
const MOTION_GAIN: Partial<Record<MotionState, number>> = {
  conspiratorial: 0.72,
  thinking: 0.85,
  deadpan: 0.88,
  sarcastic: 0.93,
};

/**
 * Gain multiplier for a motion, scaled by intensity (0-1). 1.0 = no change.
 * Intensity interpolates from neutral (1.0) toward the motion's full gain.
 */
export function gainForMotion(motion?: MotionState, intensity = 0.7): number {
  if (!motion) return 1;
  const target = MOTION_GAIN[motion];
  if (target === undefined) return 1;
  const i = clamp(intensity, 0, 1);
  return 1 + (target - 1) * i;
}

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
    // Stability floor 0.2: Toast's base is already low (0.4), and a full-strength
    // laugh/energetic delta drove it toward ~0.05 — which renders as warbly,
    // distorted audio (reported on car speakers). Below ~0.2 EL output degrades.
    stability: clamp(base.stability + (delta.stability ?? 0) * i, 0.2, 1),
    style: clamp(base.style + (delta.style ?? 0) * i, 0, 1),
    speed: clamp(base.speed + (delta.speed ?? 0) * i, 0.7, 1.2),
  };
}

/**
 * Final voice settings for scripted Roast openers. Apply this after motion
 * deltas so the prefetched path and watchdog fallback synthesize the first line
 * with the same quieter register.
 */
export function voiceSettingsForRoastOpener(
  base: VoiceSettings,
  motion?: MotionState,
  intensity = 0.7,
): VoiceSettings {
  const merged = voiceSettingsForMotion(base, motion, intensity);
  return {
    ...merged,
    style: Math.min(merged.style, ROAST_OPENER_STYLE_CAP),
    speed: Math.min(merged.speed, ROAST_OPENER_SPEED_CAP),
  };
}
