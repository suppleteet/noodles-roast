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

import type { ExperienceType, VoiceSettings } from "@/store/useSessionStore";
import type { MotionState } from "@/lib/stateMachine";

export const ROAST_OPENER_STYLE_CAP = 0.25;
export const ROAST_OPENER_SPEED_CAP = 0.88;

/**
 * Toastie's generated source voice is already fast, slurred, and highly
 * expressive. Treat these as quality rails, not a second character preset:
 * both experiences still start from DEFAULT_VOICE_SETTINGS, but motion must
 * not compound that source voice into unstable, style-maxed synthesis.
 */
export const TOAST_MIN_STABILITY = 0.6;
export const TOAST_MAX_STYLE = 0.1;
export const TOAST_MAX_SPEED = 1;

/** Raw Toastie PCM measures roughly 4-5 dB louder at onset than Roastie. */
export const TOAST_OUTPUT_GAIN = 0.56;

/**
 * Per-motion offsets. Each value is ADDED to the base setting before clamping.
 * `null` means no offset.
 */
interface VoiceDelta {
  stability?: number;
  style?: number;
  speed?: number;
}

export type VoiceContinuityMode = "inherit" | "smooth";

/**
 * Resolve the next line's voice profile against the line already in the audio
 * queue. Fillers inherit the exact prior profile; generated jokes may move
 * toward their requested delivery, but only by a bounded amount at the
 * boundary. This keeps one performer sounding like one performer while still
 * allowing the joke's energy to build after the handoff.
 */
export function voiceSettingsForContinuity(
  target: VoiceSettings,
  previous: VoiceSettings | null,
  mode?: VoiceContinuityMode,
): VoiceSettings {
  if (!previous || !mode) return target;
  if (mode === "inherit") return { ...previous };

  const step = (from: number, to: number, maxDelta: number): number =>
    clamp(to, from - maxDelta, from + maxDelta);

  return {
    ...target,
    stability: step(previous.stability, target.stability, 0.1),
    similarity_boost: step(previous.similarity_boost, target.similarity_boost, 0.05),
    style: step(previous.style, target.style, 0.1),
    speed: step(previous.speed, target.speed, 0.05),
  };
}

/** Match the voice-profile transition for playback gain as well. */
export function gainForContinuity(
  target: number,
  previous: number | null,
  mode?: VoiceContinuityMode,
): number {
  if (previous === null || !mode) return target;
  if (mode === "inherit") return previous;
  return clamp(target, previous - 0.08, previous + 0.08);
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

/**
 * Apply source-voice quality rails after motion deltas. Toastie's personality
 * is already baked into its generated voice and writing, so stability/style
 * extremes only add warble and shouting. Roastie remains unchanged.
 */
export function voiceSettingsForExperience(
  settings: VoiceSettings,
  experienceType: ExperienceType,
): VoiceSettings {
  if (experienceType !== "toast") return settings;
  return {
    ...settings,
    stability: Math.max(settings.stability, TOAST_MIN_STABILITY),
    style: Math.min(settings.style, TOAST_MAX_STYLE),
    speed: Math.min(settings.speed, TOAST_MAX_SPEED),
  };
}

/**
 * Match Toastie's objectively hotter source level before both the recording
 * branch and the speaker master. This creates real PCM headroom instead of
 * merely turning down the device output after the recording split.
 */
export function gainForExperience(gain: number, experienceType: ExperienceType): number {
  return experienceType === "toast" ? clamp(gain * TOAST_OUTPUT_GAIN, 0, 1) : gain;
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
