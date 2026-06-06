import { NextRequest, NextResponse } from "next/server";
import { ROAST_MODEL } from "@/lib/constants";
import { getJokePrompt } from "@/lib/prompts";
import { getToastieBasePrompt, getToastieContextInstructions } from "@/lib/toastiePrompts";
import type { BurnIntensity } from "@/lib/prompts";
import { PERSONA_IDS, DEFAULT_PERSONA, type PersonaId } from "@/lib/personas";
import type { MotionState } from "@/lib/motionStates";
import { getSession, getContextInstructions, sendMessage, compactStableContext } from "@/lib/chatSessionStore";
import { QuotaError, ModelUnavailableError } from "@/lib/llmClient";
import { generateText, type UserPart } from "@/lib/llmClient";
import { trimObservations } from "@/lib/visionDiff";

export type JokeContext =
  | "greeting"
  | "rapid_fire_greeting"
  | "vision_opening"
  | "answer_roast"
  | "vision_react"
  | "hopper"
  | "wrapup";

export interface JokeItem {
  text: string;
  motion: MotionState;
  intensity: number;
  score: number;
}

export interface JokeResponse {
  relevant: boolean;
  jokes: JokeItem[];
  redirect?: string;
  callback?: { text: string; motion: MotionState; intensity: number };
  tags?: string[];
}

export interface GenerateJokeRequest {
  context: JokeContext;
  sessionId?: string;
  model?: string;
  persona: PersonaId;
  burnIntensity: BurnIntensity;
  contentMode?: "clean" | "vulgar";
  /** "roast" (default) routes through persona prompts; "toastie" uses the
   *  drunk-toaster character (Toastie). The brain reads the user's selection
   *  from the store and threads it on every request. */
  experienceType?: "roast" | "toastie";
  question?: string;
  userAnswer?: string;
  fillerAlreadySaid?: string;
  jokesAlreadyDelivered?: string[];
  observations?: string[];
  previousObservations?: string[];
  conversationSoFar?: string[];
  knownFacts?: string[];
  maxJokes?: number;
  imageBase64?: string;
  setting?: string | null;
  ambientContext?: {
    city: string;
    region: string;
    timeOfDay: string;
    localTime: string;
    weather?: string;
    tempF?: number;
    tempC?: number;
  };
  /** When set, suppresses the stock AMBIENT paragraph — avoids copy-pasting city/day/weather every joke. */
  ambientAntiRepeatNote?: string;
  /** Async local culture/vibe line — crystals, hippie town, suburbs, etc. */
  townFlavor?: string;
}

/** Build user message text from the request body. */
function buildUserText(body: GenerateJokeRequest, taskPreamble?: string): string {
  const contextLines: string[] = [];

  if (taskPreamble) contextLines.push(taskPreamble);
  if (body.question) contextLines.push(`QUESTION ASKED: "${body.question}"`);
  if (body.userAnswer) contextLines.push(`USER'S ANSWER: "${body.userAnswer}"`);
  if (body.fillerAlreadySaid) {
    contextLines.push(
      `FILLER ALREADY SPOKEN: "${body.fillerAlreadySaid}" was already said aloud. Do NOT open with that filler, the user's answer, or the same first phrase. Start with the roast angle, consequence, or comparison instead.`,
    );
  }
  if (body.jokesAlreadyDelivered?.length)
    contextLines.push(`JOKES ALREADY DELIVERED THIS CYCLE:\n${body.jokesAlreadyDelivered.map((j, i) => `${i + 1}. "${j}"`).join("\n")}`);
  if (body.observations?.length)
    contextLines.push(`CURRENT OBSERVATIONS: ${trimObservations(body.observations, body.setting).join("; ")}`);
  if (body.setting)
    contextLines.push(`SETTING: The person appears to be in their ${body.setting}.`);
  if (body.previousObservations?.length)
    contextLines.push(`PREVIOUS OBSERVATIONS: ${body.previousObservations.join("; ")}`);
  if (body.conversationSoFar?.length)
    contextLines.push(`CONVERSATION SO FAR:\n${body.conversationSoFar.slice(-6).join("\n")}`);
  if (body.knownFacts?.length)
    contextLines.push(`KNOWN FACTS: ${body.knownFacts.join(", ")}`);
  if (body.townFlavor?.trim()) {
    contextLines.push(
      `LOCAL PLACE VIBE (background texture only — do NOT lean on this): ${body.townFlavor.trim()}\nUSE IT SPARINGLY: name the town/location in AT MOST one joke, and NOT in back-to-back jokes. Most jokes should roast the person and their answers, not the location.`,
    );
  }
  if (body.ambientAntiRepeatNote) {
    contextLines.push(body.ambientAntiRepeatNote);
  } else if (body.ambientContext) {
    const ac = body.ambientContext;
    // Use city only (no region/county). Time is vague ("on a Wednesday morning"), never exact.
    const dayName = new Date().toLocaleDateString("en-US", { weekday: "long" });
    contextLines.push(`AMBIENT (use sparingly, only when funny): They're in ${ac.city} on a ${dayName} ${ac.timeOfDay}.${ac.weather ? ` Weather: ${ac.weather}.` : ""} NEVER say the exact time. Say things like "you're up this late" or "on a ${dayName} morning" or "in this weather".`);
  }
  if (body.maxJokes)
    contextLines.push(`Generate exactly ${body.maxJokes} joke(s).`);

  return contextLines.length > 0 ? contextLines.join("\n\n") : "Generate jokes based on the context.";
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as GenerateJokeRequest;
    const model = body.model ?? ROAST_MODEL;

    // Try to use an existing chat session
    const session = body.sessionId ? getSession(body.sessionId) : null;

    // Strip stable blocks already in chat history (townFlavor, setting,
    // ambientContext, conversationSoFar) so per-turn prompts stay compact.
    if (session && body.sessionId) compactStableContext(body.sessionId, body);

    let rawText: string;

    // Experience type: session-stored if available, else fall back to the
    // body's hint, else default to "roast". Belt-and-suspenders so we never
    // route a Toastie session through roast prompts (and vice versa).
    const sessionExperienceType = session?.experienceType ?? null;
    const bodyExperienceType = body.experienceType === "toastie" ? "toastie" : "roast";
    const experienceType = sessionExperienceType ?? bodyExperienceType;

    if (session) {
      // ── Multi-turn path: persona is in the session's system prompt ──
      const taskPreamble = getContextInstructions(
        body.context ?? "hopper",
        session.contentMode,
        session.experienceType,
      );
      const userParts: UserPart[] = [];
      userParts.push({ text: buildUserText(body, taskPreamble) });
      if (body.imageBase64) {
        userParts.push({ inlineData: { mimeType: "image/jpeg", data: body.imageBase64 } });
      }

      rawText = await sendMessage(body.sessionId!, userParts, 512) ?? "";
    } else {
      // ── Stateless fallback: full system prompt on every request ──
      const personaId: PersonaId = PERSONA_IDS.includes(body.persona)
        ? body.persona
        : DEFAULT_PERSONA;
      const burnIntensity: BurnIntensity = ([1, 2, 3, 4, 5] as const).includes(body.burnIntensity)
        ? body.burnIntensity
        : 3;
      const contentMode = body.contentMode === "vulgar" ? "vulgar" : "clean";
      // Toastie: drunk-toaster system prompt (one character, ignores persona).
      // Roast: existing persona-based prompt.
      const systemPrompt =
        experienceType === "toastie"
          ? `${getToastieBasePrompt(burnIntensity, contentMode)}\n\n${getToastieContextInstructions(
              body.context ?? "hopper",
              contentMode,
            )}`
          : getJokePrompt(body.context ?? "hopper", personaId, burnIntensity, contentMode);

      const userParts: UserPart[] = [];
      userParts.push({ text: buildUserText(body) });
      if (body.imageBase64) {
        userParts.push({ inlineData: { mimeType: "image/jpeg", data: body.imageBase64 } });
      }

      rawText = await generateText({
        model,
        systemPrompt,
        userParts,
        maxOutputTokens: 512,
        forceJsonObject: true,
      });
    }

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("[generate-joke] No JSON in response:", rawText);
      return NextResponse.json(
        { error: "Model returned non-JSON response" },
        { status: 500 }
      );
    }

    const parsed = JSON.parse(jsonMatch[0]) as JokeResponse;

    const response: JokeResponse = {
      relevant: parsed.relevant ?? true,
      jokes: Array.isArray(parsed.jokes) ? parsed.jokes : [],
      redirect: parsed.redirect,
      callback: parsed.callback,
      tags: parsed.tags,
    };

    return NextResponse.json(response);
  } catch (err) {
    if (err instanceof QuotaError) {
      console.error("[generate-joke] QUOTA:", err.message);
      return NextResponse.json(
        { error: "quota_exceeded", provider: err.provider, detail: err.message },
        { status: 402 }
      );
    }
    if (err instanceof ModelUnavailableError) {
      console.error("[generate-joke] MODEL_UNAVAILABLE:", err.failedModel, "→", err.suggestedFallback);
      return NextResponse.json(
        {
          error: "model_unavailable",
          failedModel: err.failedModel,
          suggestedFallback: err.suggestedFallback,
        },
        { status: 503 }
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[generate-joke]", message);
    return NextResponse.json(
      { error: "Joke generation failed", detail: message },
      { status: 500 }
    );
  }
}
