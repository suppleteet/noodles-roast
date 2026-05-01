import type { JokeResponse } from "@/app/api/generate-joke/route";
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
      model: "gemini-2.5-flash",
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
      model: "gemini-2.5-flash",
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
 * Pre-roast startup path:
 * 1. Analyze the frame into compact observations.
 * 2. Generate the opening joke from those observations as text.
 * 3. Only if analysis fails, try one direct image greeting, then a generated generic fallback.
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

  let observations: string[] = [];
  if (greetingFrame) {
    useSessionStore.getState().logTiming("live: greeting vision fired");
    const visionData = await postJsonWithRetry<VisionData>(
      "/api/analyze",
      {
        imageBase64: greetingFrame,
        burnIntensity: snapshot.burnIntensity,
        mode: "vision",
        persona: snapshot.activePersona,
      },
      { retries: 0, timeoutMs: 6500 },
    );
    observations = rememberVisionData(visionData);
  }

  if (observations.length) {
    const fromVision = await generateGreetingFromObservations(observations, snapshot);
    if (fromVision?.jokes.length) return fromVision;
  }

  if (greetingFrame) {
    useSessionStore.getState().logTiming("live: greeting direct-image fallback fired");
    const direct = await generateDirectImageGreeting(greetingFrame, snapshot);
    if (direct?.jokes.length) return direct;
  }

  useSessionStore.getState().logTiming("live: greeting generic fallback fired");
  return generateGreetingFromObservations([], snapshot);
}
