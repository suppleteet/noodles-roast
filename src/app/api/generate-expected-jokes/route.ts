/**
 * Speculative pre-generation endpoint for Rapid Fire flow.
 *
 * Called BEFORE the user has answered a rapid-fire question. Takes the
 * question + its expected-answer keys, returns a map of `{answerKey -> 2
 * jokes}`. The brain caches the response and, when the user actually
 * answers, fuzzy-matches the answer to a key and fires the matching joke
 * pair instantly — no second LLM round trip.
 *
 * Stateless (no chat session reuse). One call per question. Cheap relative
 * to the snappiness payoff: the alternative is firing N parallel
 * generate-joke calls or waiting for the answer before generating.
 *
 * Failure modes (all return 200 with empty jokesByAnswer so the brain
 * gracefully falls back to fresh gen):
 *   - LLM returns malformed JSON
 *   - LLM returns keys that don't match expectedAnswers
 *   - Network/quota error from the LLM
 */
import { NextRequest, NextResponse } from "next/server";
import { ROAST_MODEL } from "@/lib/constants";
import { getExpectedJokesSystemPrompt } from "@/lib/prompts";
import type { BurnIntensity } from "@/lib/prompts";
import { PERSONA_IDS, DEFAULT_PERSONA, type PersonaId } from "@/lib/personas";
import type { MotionState } from "@/lib/motionStates";
import type { JokeItem } from "@/app/api/generate-joke/route";
import { generateText, QuotaError } from "@/lib/llmClient";

interface GenerateExpectedJokesRequest {
  question: string;
  expectedAnswers: string[];
  persona: PersonaId;
  burnIntensity: BurnIntensity;
  contentMode?: "clean" | "vulgar";
  model?: string;
  knownFacts?: string[];
}

export interface ExpectedJokesResponse {
  jokesByAnswer: Record<string, JokeItem[]>;
}

const VALID_MOTIONS: ReadonlySet<MotionState> = new Set<MotionState>([
  "idle", "laugh", "energetic", "smug", "conspiratorial", "shocked", "emphasis", "thinking",
]);

/** Normalize an answer key the way the brain's matcher does — same canonical form. */
function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9' ]/g, " ").replace(/\s+/g, " ").trim();
}

/** Validate + coerce a raw joke object into a sanitized JokeItem (or null if unsalvageable). */
function sanitizeJoke(raw: unknown): JokeItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const text = typeof r.text === "string" ? r.text.trim() : "";
  if (!text) return null;
  const motion = (typeof r.motion === "string" && VALID_MOTIONS.has(r.motion as MotionState)
    ? r.motion
    : "emphasis") as MotionState;
  const intensity = typeof r.intensity === "number" && r.intensity >= 0 && r.intensity <= 1 ? r.intensity : 0.7;
  const score = typeof r.score === "number" ? r.score : 7;
  return { text, motion, intensity, score };
}

export async function POST(req: NextRequest) {
  let body: GenerateExpectedJokesRequest;
  try {
    body = (await req.json()) as GenerateExpectedJokesRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.question || !Array.isArray(body.expectedAnswers) || body.expectedAnswers.length === 0) {
    return NextResponse.json(
      { error: "question and expectedAnswers (non-empty) are required" },
      { status: 400 },
    );
  }

  const personaId: PersonaId = PERSONA_IDS.includes(body.persona) ? body.persona : DEFAULT_PERSONA;
  const contentMode = body.contentMode === "vulgar" ? "vulgar" : "clean";
  const model = body.model ?? ROAST_MODEL;
  // Clamp burnIntensity to 1-5; default to 3 if missing or invalid so the
  // prompt builder doesn't index INTENSITY_FLAVOR with undefined.
  const burnIntensity: BurnIntensity = (
    typeof body.burnIntensity === "number" && body.burnIntensity >= 1 && body.burnIntensity <= 5
      ? body.burnIntensity
      : 3
  ) as BurnIntensity;

  const systemPrompt = getExpectedJokesSystemPrompt(personaId, burnIntensity, contentMode);

  const userLines: string[] = [
    `QUESTION ABOUT TO BE ASKED: "${body.question}"`,
    `LIKELY ANSWERS (use these as the keys in jokesByAnswer, EXACTLY as written):`,
    ...body.expectedAnswers.map((a) => `  - "${a}"`),
  ];
  if (body.knownFacts && body.knownFacts.length > 0) {
    userLines.push(`KNOWN FACTS: ${body.knownFacts.join(", ")}`);
  }
  userLines.push(
    `\nFor each answer key, return exactly 2 jokes. Second joke must escalate or pivot — not restate the first.`,
  );

  let raw: string;
  try {
    raw = await generateText({
      model,
      systemPrompt,
      userParts: [{ text: userLines.join("\n") }],
      maxOutputTokens: 1200,
      forceJsonObject: true,
    });
  } catch (err) {
    if (err instanceof QuotaError) {
      console.error("[generate-expected-jokes] QUOTA:", err.message);
      return NextResponse.json({ jokesByAnswer: {} });
    }
    console.error("[generate-expected-jokes] LLM error:", err);
    return NextResponse.json({ jokesByAnswer: {} });
  }

  // Extract JSON — strip code fences, isolate the outermost object.
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.warn("[generate-expected-jokes] no JSON in response:", raw.slice(0, 200));
    return NextResponse.json({ jokesByAnswer: {} });
  }
  let parsed: { jokesByAnswer?: Record<string, unknown> };
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.warn("[generate-expected-jokes] JSON parse failed:", err);
    return NextResponse.json({ jokesByAnswer: {} });
  }

  const rawMap = parsed.jokesByAnswer;
  if (!rawMap || typeof rawMap !== "object") {
    console.warn("[generate-expected-jokes] response missing jokesByAnswer");
    return NextResponse.json({ jokesByAnswer: {} });
  }

  // Sanitize: only keep keys that match one of the expected answers (LLM
  // sometimes drifts on the exact spelling). Match against normalized form so
  // "Yes" / "yes." / "yes " all resolve to the same canonical key from the
  // request. The output uses the EXACT casing the request sent in.
  const canonicalToExpected = new Map<string, string>();
  for (const exp of body.expectedAnswers) {
    canonicalToExpected.set(normalizeKey(exp), exp);
  }

  const jokesByAnswer: Record<string, JokeItem[]> = {};
  for (const [rawKey, rawJokes] of Object.entries(rawMap)) {
    const canonical = normalizeKey(rawKey);
    const expectedKey = canonicalToExpected.get(canonical);
    if (!expectedKey) continue;
    if (!Array.isArray(rawJokes)) continue;
    const jokes = rawJokes.map(sanitizeJoke).filter((j): j is JokeItem => j !== null);
    if (jokes.length === 0) continue;
    jokesByAnswer[expectedKey] = jokes.slice(0, 2); // cap at 2 per key (the burst size)
  }

  return NextResponse.json({ jokesByAnswer });
}
