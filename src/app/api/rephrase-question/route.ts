import { NextRequest, NextResponse } from "next/server";
import { ROAST_MODEL } from "@/lib/constants";
import { PERSONAS, DEFAULT_PERSONA, PERSONA_IDS, type PersonaId } from "@/lib/personas";
import type { BurnIntensity } from "@/lib/prompts";
import { generateText } from "@/lib/llmClient";

interface RephraseRequest {
  question: string;
  model?: string;
  persona: PersonaId;
  burnIntensity: BurnIntensity;
  knownFacts?: string[];
  previousLine?: string;
}

/**
 * Hard cap on the rephrased question — the LLM tends to ignore "keep it short"
 * instructions when in-character ("So rather than wasting my time on this
 * garbage of yours, how many years have you been roaming this earth..."). This
 * gates the result server-side so even when the prompt fails, the user doesn't
 * hear a 30-word monologue.
 */
const MAX_QUESTION_WORDS = 15;

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as RephraseRequest;
    const model = body.model ?? ROAST_MODEL;
    const personaId: PersonaId = PERSONA_IDS.includes(body.persona) ? body.persona : DEFAULT_PERSONA;
    const persona = PERSONAS[personaId];

    const systemPrompt =
      `You are ${persona.name}.\n` +
      `Character voice: ${persona.toneDescription}\n\n` +
      `Rephrase the given question in your character's voice. Rules:\n` +
      `- HARD LIMIT: under ${MAX_QUESTION_WORDS} words. ONE sentence. No second clause. No "and don't give me any bullshit", no "instead of wasting my time", no preambles, no tails.\n` +
      `- Stay in character — but the character lives in the QUESTION ITSELF. Don't pad with attitude before/after it.\n` +
      `- If you know their name, use it naturally (once).\n` +
      `- Do NOT make a joke or add commentary — just ask the question.\n` +
      `- If PREVIOUS LINE is provided, ONE casual transition word is fine ("Alright,", "Now,", "So,", "Okay,") — pick the energy up briefly, then go straight to the question.\n` +
      `- Return ONLY the rephrased question text, nothing else.\n\n` +
      `GOOD examples (short, in-character, single clause):\n` +
      `  "Alright, how old are you?"\n` +
      `  "So Tyler, what's your job?"\n` +
      `  "Where the hell are you from?"\n` +
      `BAD (too long — these would be REJECTED):\n` +
      `  "So rather than wasting my time on this garbage of yours, how many years have you been roaming this earth, you sad bastard?"\n` +
      `  "Tell me Tyler, and don't bullshit me, what's the actual honest-to-god thing you do for a living?"`;

    const userLines: string[] = [`Rephrase this question: "${body.question}"`];
    if (body.previousLine) {
      userLines.push(`PREVIOUS LINE (what you just said): "${body.previousLine}"`);
    }
    if (body.knownFacts?.length) {
      userLines.push(`Known facts: ${body.knownFacts.join(", ")}`);
    }

    const rephrased = (await generateText({
      model,
      systemPrompt,
      userParts: [{ text: userLines.join("\n") }],
      maxOutputTokens: 60,
      // Rephrase returns plain text, not JSON.
      forceJsonObject: false,
    })).trim();

    // Server-side enforcement: if the LLM ignored the cap (it often does when in-character),
    // throw the rephrase out and fall back to the original short question. The brain will
    // either deliver the original verbatim or bridge it with a minimal transition word.
    const finalQuestion = rephrased && wordCount(rephrased) <= MAX_QUESTION_WORDS
      ? rephrased
      : body.question;

    if (rephrased && finalQuestion !== rephrased) {
      console.warn(
        `[rephrase-question] LLM exceeded ${MAX_QUESTION_WORDS}-word cap (${wordCount(rephrased)}w) — falling back to original. raw="${rephrased.slice(0, 120)}"`,
      );
    }

    return NextResponse.json({ rephrased: finalQuestion });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[rephrase-question]", message);
    // Return fallback — caller will use original question text
    return NextResponse.json({ rephrased: "" }, { status: 500 });
  }
}
