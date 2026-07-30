import { NextRequest, NextResponse } from "next/server";
import { ROAST_MODEL } from "@/lib/constants";
import { ApiRequestError, readLimitedJson } from "@/lib/apiRequest";
import { generateText } from "@/lib/llmClient";
import { isRoastModelId } from "@/lib/modelCatalog";
import {
  chooseTranscriptRepair,
  type TranscriptRepairCandidate,
  type TranscriptRepairRequest,
} from "@/lib/transcriptRepair";

function boundedStrings(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .slice(-limit)
    .map((item) => item.slice(0, 300));
}

export async function POST(req: NextRequest) {
  let body: TranscriptRepairRequest;
  try {
    body = await readLimitedJson<TranscriptRepairRequest>(req, 100_000);
  } catch (error) {
    const status = error instanceof ApiRequestError ? error.status : 400;
    const message =
      error instanceof ApiRequestError ? error.message : "Invalid JSON";
    return NextResponse.json({ error: message }, { status });
  }

  if (
    typeof body.transcript !== "string" ||
    body.transcript.trim().length === 0 ||
    body.transcript.length > 500 ||
    typeof body.question !== "string" ||
    body.question.length > 500 ||
    typeof body.questionId !== "string" ||
    body.questionId.length > 100
  ) {
    return NextResponse.json({ error: "Invalid transcript context" }, { status: 400 });
  }
  if (body.model !== undefined && !isRoastModelId(body.model)) {
    return NextResponse.json({ error: "Unsupported model" }, { status: 400 });
  }

  const model = body.model ?? ROAST_MODEL;
  const knownFacts = boundedStrings(body.knownFacts, 20);
  const conversationSoFar = boundedStrings(body.conversationSoFar, 6);
  const fallback = chooseTranscriptRepair(
    body.transcript,
    body.questionId,
    knownFacts,
    {},
  );

  const systemPrompt = `You repair obvious speech-to-text errors in a live conversation.

Be extremely conservative. The transcript is what the person actually said unless there is
strong contextual and phonetic evidence of a small STT mistake.

Rules:
- Make the SMALLEST possible correction: usually one phonetically similar word, spacing, or segmentation.
- Use the question, established facts, and recent conversation as evidence.
- Never improve grammar, paraphrase, summarize, censor, or make an answer more interesting.
- Preserve negation, numbers, intent, jokes, slang, and deliberately weird answers.
- Never guess the spelling of a brand-new person's name. Only restore a name already present in ESTABLISHED FACTS.
- If two readings are plausible, do not change it.
- "Dennis" for a job may be "dentist"; "Woodwicker" may be established "Woodacre".
- "I train ferrets for tax season" is unusual but coherent: preserve it exactly.

Return ONLY JSON:
{
  "correctedText": "the minimally repaired transcript, or the original",
  "changed": boolean,
  "confidence": number,
  "reason": "brief evidence, or unchanged"
}

Set changed=true only at confidence 0.86 or higher.`;

  const context = [
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

  try {
    const raw = await generateText({
      model,
      systemPrompt,
      userParts: [{ text: context }],
      maxOutputTokens: 160,
      reasoningProfile: "realtime-utility",
      forceJsonObject: true,
    });
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return NextResponse.json(fallback);
    const candidate = JSON.parse(match[0]) as TranscriptRepairCandidate;
    return NextResponse.json(
      chooseTranscriptRepair(
        body.transcript,
        body.questionId,
        knownFacts,
        candidate,
      ),
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
