import { NextRequest, NextResponse } from "next/server";
import { VISION_MODEL } from "@/lib/constants";
import { ApiRequestError, readLimitedJson } from "@/lib/apiRequest";
import { generateText } from "@/lib/llmClient";
import {
  chooseTranscriptRepair,
  type TranscriptRepairCandidate,
  type TranscriptRepairRequest,
  type TranscriptRepairResult,
} from "@/lib/transcriptRepair";

const SYSTEM_PROMPT = `You repair obvious speech-to-text errors in a live conversation.

Be extremely conservative. The transcript is what the person actually said unless there is
strong contextual and phonetic evidence of a small STT mistake.

Rules:
- Make the SMALLEST possible correction: one phonetically similar word, spacing, or segmentation.
- Use the question, established facts, and recent conversation as evidence.
- Never improve grammar, paraphrase, summarize, censor, or make an answer more interesting.
- Preserve negation, numbers, intent, jokes, slang, and deliberately weird answers.
- Never guess the spelling of a brand-new person's name. Only restore a name already present in ESTABLISHED FACTS.
- If two readings are plausible, do not change it.
- "Dennis" for a job may be "dentist"; "Woodwicker" may be established "Woodacre".
- If the known name is different and a work-from-home answer reads "I'm Martin from home",
  "Martin" is likely a segmented/misheard "working": restore "I'm working from home".
- "I train ferrets for tax season" is unusual but coherent: preserve it exactly.

Return ONLY JSON:
{
  "correctedText": "the minimally repaired transcript, or the original",
  "changed": boolean,
  "confidence": number,
  "reason": "brief evidence, or unchanged"
}

Set changed=true only at confidence 0.86 or higher.`;

function boundedStrings(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .slice(-limit)
    .map((item) => item.slice(0, 300));
}

function isTranscriptRepairRequest(
  value: unknown,
): value is TranscriptRepairRequest {
  if (typeof value !== "object" || value === null) return false;
  // JSON boundary: required fields are validated before use.
  const body = value as Record<string, unknown>;
  return (
    typeof body.transcript === "string" &&
    body.transcript.trim().length > 0 &&
    body.transcript.length <= 500 &&
    typeof body.question === "string" &&
    body.question.length <= 500 &&
    typeof body.questionId === "string" &&
    body.questionId.length <= 100 &&
    Array.isArray(body.knownFacts) &&
    Array.isArray(body.conversationSoFar)
  );
}

function buildContext(
  body: TranscriptRepairRequest,
  knownFacts: string[],
  conversationSoFar: string[],
): string {
  return [
    `QUESTION ID: ${body.questionId}`,
    `QUESTION: "${body.question}"`,
    `RAW STT TRANSCRIPT: "${body.transcript}"`,
    knownFacts.length
      ? `ESTABLISHED FACTS:\n${knownFacts.map((fact) => `- ${fact}`).join("\n")}`
      : "ESTABLISHED FACTS: none",
    conversationSoFar.length
      ? `RECENT CONVERSATION:\n${conversationSoFar.join("\n")}`
      : "RECENT CONVERSATION: none",
  ].join("\n\n");
}

async function generateRepair(
  body: TranscriptRepairRequest,
  knownFacts: string[],
  conversationSoFar: string[],
): Promise<TranscriptRepairResult | null> {
  const raw = await generateText({
    // Fixed server-side utility model: callers cannot select a costly roast model.
    model: VISION_MODEL,
    systemPrompt: SYSTEM_PROMPT,
    userParts: [{ text: buildContext(body, knownFacts, conversationSoFar) }],
    maxOutputTokens: 160,
    reasoningProfile: "realtime-utility",
    forceJsonObject: true,
  });
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  const parsed: unknown = JSON.parse(match[0]);
  // Provider JSON boundary: chooseTranscriptRepair validates every candidate
  // property; non-object JSON is treated as an unchanged transcript.
  const candidate =
    typeof parsed === "object" && parsed !== null
      ? (parsed as TranscriptRepairCandidate)
      : {};
  return chooseTranscriptRepair(
    body.transcript,
    body.questionId,
    knownFacts,
    candidate,
  );
}

export async function POST(req: NextRequest) {
  let body: TranscriptRepairRequest;
  try {
    const parsed = await readLimitedJson<unknown>(req, 100_000);
    if (!isTranscriptRepairRequest(parsed)) {
      return NextResponse.json(
        { error: "Invalid transcript context" },
        { status: 400 },
      );
    }
    body = parsed;
  } catch (error) {
    const status = error instanceof ApiRequestError ? error.status : 400;
    const message =
      error instanceof ApiRequestError ? error.message : "Invalid JSON";
    return NextResponse.json({ error: message }, { status });
  }

  const knownFacts = boundedStrings(body.knownFacts, 20);
  const conversationSoFar = boundedStrings(body.conversationSoFar, 6);
  const fallback = chooseTranscriptRepair(
    body.transcript,
    body.questionId,
    knownFacts,
    {},
  );

  try {
    return NextResponse.json(
      (await generateRepair(body, knownFacts, conversationSoFar)) ?? fallback,
    );
  } catch (error) {
    // Repair is optional enrichment. A provider hiccup must never block or end
    // the show; the brain proceeds with the original STT transcript.
    console.warn(
      "[repair-transcript] using original:",
      error instanceof Error ? error.message : String(error),
    );
    return NextResponse.json(fallback);
  }
}
