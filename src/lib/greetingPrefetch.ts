import type { JokeContext, JokeResponse } from "@/app/api/generate-joke/route";
import { VISION_MODEL } from "@/lib/constants";
import type { BurnIntensity } from "@/lib/prompts";
import { PERSONAS, type PersonaId } from "@/lib/personas";
import { pickCannedIntro } from "@/lib/comedians/types";
import type { ContentMode, VoiceSettings } from "@/store/useSessionStore";
import { useSessionStore } from "@/store/useSessionStore";
import { TtsChunkBuffer } from "@/lib/ttsChunkBuffer";
import { voiceSettingsForMotion, voiceSettingsForRoastOpener } from "@/lib/voiceMotionPresets";
import type { MotionState } from "@/lib/motionStates";

export interface GreetingPrefetchSnapshot {
  activePersona: PersonaId;
  burnIntensity: BurnIntensity;
  contentMode: ContentMode;
  /** Override the default VISION_MODEL — set when fallback was applied. */
  visionModel?: string;
  /** "roast" | "toast" — routes the greeting through the right prompt set
   *  AND picks the right TTS voice (Toast uses a warmer female voice). */
  experienceType?: "roast" | "toast";
}

interface VisionData {
  observations?: string[];
  setting?: string | null;
}

async function postJsonWithRetry<T>(
  url: string,
  payload: unknown,
  options?: { retries?: number; timeoutMs?: number },
): Promise<T | null> {
  const retries = options?.retries ?? 1;
  const timeoutMs = options?.timeoutMs ?? 5000;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (resp.ok) return (await resp.json()) as T;
      // 503 with model_unavailable body — surface the fallback prompt now so the
      // user doesn't watch the greeting fail through several retry tiers before
      // the brain catches it. Idempotent: store already gates setModelUnavailable
      // on null.
      if (resp.status === 503) {
        try {
          const body = await resp.clone().json() as {
            error?: string; failedModel?: string; suggestedFallback?: string;
          };
          if (body.error === "model_unavailable" && body.failedModel && body.suggestedFallback) {
            const store = useSessionStore.getState();
            if (!store.modelUnavailable) {
              store.setModelUnavailable({
                failedModel: body.failedModel,
                suggestedFallback: body.suggestedFallback,
              });
              store.logTiming(`prefetch: model unavailable — ${body.failedModel}`);
            }
            return null; // don't retry — the user will pick the fallback
          }
        } catch { /* not the structured body we expected — fall through */ }
      }
      if (attempt < retries && (resp.status === 429 || resp.status >= 500)) {
        await new Promise<void>((resolve) => setTimeout(resolve, 200 * Math.pow(2, attempt)));
        continue;
      }
      return null;
    } catch {
      if (attempt < retries) {
        await new Promise<void>((resolve) => setTimeout(resolve, 200 * Math.pow(2, attempt)));
        continue;
      }
      return null;
    }
  }
  return null;
}

function normalizeObservations(observations: string[] | undefined): string[] {
  return (observations ?? [])
    .map((obs) => obs.trim())
    .filter(Boolean)
    .slice(0, 6);
}

function rememberVisionData(visionData: VisionData | null): string[] {
  if (!visionData) return [];
  const observations = normalizeObservations(visionData.observations);
  const setting = visionData.setting ?? null;
  if (observations.length) {
    useSessionStore.getState().setObservations(observations);
    useSessionStore.getState().logTiming(
      `live: greeting vision - ${observations.length} obs - ${observations.join("; ").slice(0, 80)}`,
    );
  } else {
    useSessionStore.getState().logTiming("live: greeting vision - 0 obs");
  }
  if (setting) useSessionStore.getState().setVisionSetting(setting);
  return observations;
}

async function generateGreetingFromObservations(
  observations: string[],
  snapshot: GreetingPrefetchSnapshot,
): Promise<JokeResponse | null> {
  return postJsonWithRetry<JokeResponse>(
    "/api/generate-joke",
    {
      context: "vision_opening" satisfies JokeContext,
      model: snapshot.visionModel ?? VISION_MODEL,
      persona: snapshot.activePersona,
      burnIntensity: snapshot.burnIntensity,
      contentMode: snapshot.contentMode,
      experienceType: snapshot.experienceType,
      observations,
      setting: useSessionStore.getState().visionSetting,
    },
    { retries: 1, timeoutMs: 5500 },
  );
}

async function generateDirectImageGreeting(
  greetingFrame: string,
  snapshot: GreetingPrefetchSnapshot,
): Promise<JokeResponse | null> {
  return postJsonWithRetry<JokeResponse>(
    "/api/generate-joke",
    {
      context: "vision_opening" satisfies JokeContext,
      model: snapshot.visionModel ?? VISION_MODEL,
      persona: snapshot.activePersona,
      burnIntensity: snapshot.burnIntensity,
      contentMode: snapshot.contentMode,
      experienceType: snapshot.experienceType,
      observations: [],
      imageBase64: greetingFrame,
    },
    { retries: 0, timeoutMs: 6500 },
  );
}

/**
 * Pre-roast startup path. Vision analysis and the first vision joke run in TRUE parallel:
 *  - `/api/analyze` fires in the background to populate observations for
 *    subsequent turns. It does NOT block the greeting.
 *  - `/api/generate-joke` with the raw image (direct-image) runs concurrently
 *    and returns the actual opening vision joke as soon as it's ready.
 *
 * The old sequential design waited up to 6.5s for vision to time out before
 * even trying direct-image — that compounded to 13+ s of dead air on slow
 * vision responses. Now direct-image returns in its own latency budget.
 *
 * Fallbacks (only if direct-image fails):
 *  1. Wait for vision; if observations land, generate-from-observations.
 *  2. Last resort: generic empty-observations generate-joke.
 */
export async function prefetchParallelVisionAndGreeting(
  greetingFrame: string | undefined,
  snapshot: GreetingPrefetchSnapshot,
): Promise<JokeResponse | null> {
  const existingObservations = normalizeObservations(useSessionStore.getState().observations);
  if (existingObservations.length) {
    useSessionStore.getState().logTiming("live: greeting using pre-scanned observations");
    const fromExisting = await generateGreetingFromObservations(existingObservations, snapshot);
    if (fromExisting?.jokes.length) return fromExisting;
  }

  if (!greetingFrame) {
    useSessionStore.getState().logTiming("live: greeting generic fallback fired (no frame)");
    return generateGreetingFromObservations([], snapshot);
  }

  useSessionStore.getState().logTiming("live: greeting vision + direct-image fired in parallel");

  // Vision runs in the background — its observations feed subsequent turns
  // but do NOT gate the greeting. Allow a longer window since we no longer
  // block on it.
  const visionPromise = postJsonWithRetry<VisionData>(
    "/api/analyze",
    {
      imageBase64: greetingFrame,
      burnIntensity: snapshot.burnIntensity,
      mode: "vision",
      persona: snapshot.activePersona,
    },
    { retries: 0, timeoutMs: 8000 },
  ).then((visionData) => {
    rememberVisionData(visionData);
    return visionData;
  });

  // Direct-image greeting: Gemini sees the image and writes the joke in
  // one call (no separate analyze step). This is the primary path.
  const direct = await generateDirectImageGreeting(greetingFrame, snapshot);
  if (direct?.jokes.length) {
    useSessionStore.getState().logTiming("live: greeting joke ready (direct-image)");
    return direct;
  }

  // Direct-image failed. If vision is still running or already done, try
  // generating from its observations as a secondary path.
  useSessionStore.getState().logTiming("live: greeting direct-image failed — falling back to vision");
  const visionData = await visionPromise.catch(() => null);
  const observations = normalizeObservations(visionData?.observations);
  if (observations.length) {
    const fromVision = await generateGreetingFromObservations(observations, snapshot);
    if (fromVision?.jokes.length) {
      useSessionStore.getState().logTiming("live: greeting joke ready (vision-fallback)");
      return fromVision;
    }
  }

  useSessionStore.getState().logTiming("live: greeting generic fallback fired");
  return generateGreetingFromObservations([], snapshot);
}

/**
 * Fire ElevenLabs TTS for the greeting joke as soon as we have the text,
 * accumulating audio chunks into a TtsChunkBuffer. The browser hands the
 * buffer to the brain when the session enters greeting, so playback starts
 * with audio already in flight — no extra round-trip to /api/tts-ws.
 *
 * The first call to this in a session also benefits from /api/prewarm-tts
 * having pre-warmed the EL DNS/TLS path.
 */
export function prefetchGreetingAudio(
  text: string,
  motion: MotionState | string | undefined,
  intensity: number | undefined,
  baseVoiceSettings: VoiceSettings,
  experienceType: "roast" | "toast" = "roast",
): TtsChunkBuffer {
  const buffer = new TtsChunkBuffer();
  if (!text.trim()) {
    buffer.finish(true);
    return buffer;
  }

  const startedAt = Date.now();
  const mergedVoice = voiceSettingsForMotion(
    baseVoiceSettings,
    motion as MotionState | undefined,
    intensity ?? 0.7,
  );

  void (async () => {
    try {
      const resp = await fetch("/api/tts-ws", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text.trim(),
          voiceSettings: mergedVoice,
          experienceType,
        }),
        // A hung route (cold compile, EL WS that never opens) must not hold this
        // buffer open forever — downstream playback waits on it. Abort → finish(true)
        // via the catch, which flips the buffer to failed so consumers fall back.
        signal: AbortSignal.timeout(10_000),
      });

      if (!resp.ok || !resp.body) {
        useSessionStore.getState().logTiming(`live: greeting tts prefetch failed (${resp.status})`);
        buffer.finish(true);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let sseBuf = "";
      let firstAudioLogged = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuf += decoder.decode(value, { stream: true });
        const lines = sseBuf.split("\n");
        sseBuf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6)) as { type: string; chunk?: string };
            if (event.type === "audio" && event.chunk) {
              if (!firstAudioLogged) {
                firstAudioLogged = true;
                useSessionStore
                  .getState()
                  .logTiming(`live: greeting tts prefetch first audio ${Date.now() - startedAt}ms`);
              }
              buffer.push(event.chunk);
            }
          } catch {
            // ignore malformed SSE
          }
        }
      }
      buffer.finish(false);
    } catch (err) {
      console.error("[greetingPrefetch] tts error:", err);
      buffer.finish(true);
    }
  })();

  return buffer;
}

/** Canned opener prefetch — the line text plus its already-streaming TTS audio. */
export interface CannedOpenerPrefetch {
  text: string;
  motion: MotionState;
  intensity: number;
  audio: TtsChunkBuffer;
}

/**
 * Canned-intro fast path: the opener line is knowable BEFORE the session
 * starts (no LLM involved), so pick it now and fire its TTS immediately —
 * the EL handshake + synthesis (~0.5-2s, the dominant TTFS cost once the
 * LLM is out of the picture) overlaps the permission/connect window instead
 * of running after the brain enters greeting. The brain speaks `text`
 * verbatim via playPrefetchedAudio so audio and transcript always match.
 *
 * Returns null when the canned intro doesn't apply (toggle off / Toast).
 */
export function prefetchCannedOpener(): CannedOpenerPrefetch | null {
  const s = useSessionStore.getState();
  if (!s.cannedIntro || s.experienceType !== "roast") return null;
  const persona = PERSONAS[s.activePersona];
  const text = pickCannedIntro(
    persona.cannedIntros,
    new Date().getHours(),
    s.contentMode === "vulgar",
  );
  // Same register and final voice caps the brain uses for scripted opening
  // lines. Keep this resolved at the final settings so the prefetched opener
  // and watchdog fallback cannot synthesize the same first line differently.
  const motion = persona.motionPreferences[0] ?? "emphasis";
  const intensity = 0.6;
  const openerVoice = voiceSettingsForRoastOpener(s.voiceSettings, motion, intensity);
  const audio = prefetchGreetingAudio(text, undefined, undefined, openerVoice, "roast");
  s.logTiming(
    `live: canned opener TTS prefetch fired (style=${openerVoice.style} speed=${openerVoice.speed}) — "${text.slice(0, 40)}…"`,
  );
  return { text, motion, intensity, audio };
}
