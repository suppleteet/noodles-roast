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
      `- ONE short sentence. No second clause, no compound questions, no parentheticals. If the original is already short and simple, return it nearly verbatim.\n` +
      `- Under 12 words. Strip every word that isn't strictly necessary.\n` +
      `- Stay in character but DO NOT embellish the question with descriptors, asides, or roast material — keep it a clean question.\n` +
      `- If you know their name, use it naturally (once, max).\n` +
      `- Do NOT make a joke, add commentary, or stack qualifiers like "what kind of actual, honest-to-god ___" — just ask the question plainly.\n` +
      `- If PREVIOUS LINE is provided, make the question feel like the next beat after that joke — pick up its energy, but ONLY through ONE short transition word ("Alright," "So," "Now," "Okay,") and the question itself. The tie-in is in the tone, NOT in stacking qualifiers like "So tell me, [name], what kind of actual, honest-to-god ___".\n` +
      `- Return ONLY the rephrased question text, nothing else`;

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
      maxOutputTokens: 80,
      // Rephrase returns plain text, not JSON.
      forceJsonObject: false,
    })).trim() || body.question;

    return NextResponse.json({ rephrased });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[rephrase-question]", message);
    // Return fallback — caller will use original question text
    return NextResponse.json({ rephrased: "" }, { status: 500 });
  }
}
