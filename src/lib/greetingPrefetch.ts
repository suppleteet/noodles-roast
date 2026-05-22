import type { JokeResponse } from "@/app/api/generate-joke/route";
import { VISION_MODEL } from "@/lib/constants";
import type { BurnIntensity } from "@/lib/prompts";
import type { PersonaId } from "@/lib/personas";
import type { ContentMode } from "@/store/useSessionStore";
import { useSessionStore } from "@/store/useSessionStore";

export interface GreetingPrefetchSnapshot {
  activePersona: PersonaId;
  burnIntensity: BurnIntensity;
  contentMode: ContentMode;
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
      context: "greeting",
      model: VISION_MODEL,
      persona: snapshot.activePersona,
      burnIntensity: snapshot.burnIntensity,
      contentMode: snapshot.contentMode,
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
      context: "greeting",
      model: VISION_MODEL,
      persona: snapshot.activePersona,
      burnIntensity: snapshot.burnIntensity,
      contentMode: snapshot.contentMode,
      observations: [],
      imageBase64: greetingFrame,
    },
    { retries: 0, timeoutMs: 6500 },
  );
}

/**
 * Pre-roast startup path. Vision and the greeting joke run in TRUE parallel:
 *  - `/api/analyze` fires in the background to populate observations for
 *    subsequent turns. It does NOT block the greeting.
 *  - `/api/generate-joke` with the raw image (direct-image) runs concurrently
 *    and returns the actual greeting joke as soon as it's ready.
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
