import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { GoogleGenAI } from "@google/genai";
import { getRoastSystemPrompt, getGreetingSystemPrompt } from "@/lib/prompts";
import { VISION_MODEL } from "@/lib/constants";
import { extractJson } from "@/lib/jsonUtils";
import type { BurnIntensity } from "@/lib/prompts";
import { PERSONA_IDS, DEFAULT_PERSONA, type PersonaId } from "@/lib/personas";
import { recordGeminiUsage } from "@/lib/usageTracker";
import { toModelUnavailableError } from "@/lib/llmClient";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const ANALYZE_RETRY_DELAYS_MS = [250, 700];

function isTransientAnalyzeError(err: unknown): boolean {
  const status = (err as { status?: number }).status;
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) return true;
  return message.includes("unavailable") || message.includes("try again later") || message.includes("overloaded");
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateWithRetry(args: Parameters<typeof ai.models.generateContent>[0]) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await ai.models.generateContent(args);
    } catch (err) {
      if (attempt < ANALYZE_RETRY_DELAYS_MS.length && isTransientAnalyzeError(err)) {
        await sleep(ANALYZE_RETRY_DELAYS_MS[attempt]);
        continue;
      }
      throw err;
    }
  }
}

type RoastSentenceRaw = { text: string; motion: string; intensity: number };

export async function POST(req: NextRequest) {
  try {
    const { imageBase64, burnIntensity = 3, mode = "roast", persona } = await req.json();
    if (!imageBase64) {
      return NextResponse.json({ error: "imageBase64 required" }, { status: 400 });
    }

    const personaId: PersonaId = PERSONA_IDS.includes(persona) ? persona : DEFAULT_PERSONA;

    // Vision-only mode: fast, focused call that returns only observations
    if (mode === "vision") {
      const response = await generateWithRetry({
        model: VISION_MODEL,
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: "image/jpeg", data: imageBase64 } },
              { text: `Return a JSON object with two fields:
- "person": array of 4-7 short observations (2-5 words each) about the person. ALWAYS include, near the front, a quick read of: apparent age range (e.g. "looks early 20s", "40s-ish", "older, maybe 60s"), apparent gender presentation (e.g. "man", "woman"), and overall build/style/vibe (e.g. "heavyset", "gym-build", "preppy", "punk", "corporate", "crunchy/granola"). Then expression, mood, posture, actions, accessories. These reads are for the comedian to tailor references to the right person — describe plainly, do not editorialize.
- "setting": a short confident guess about where they are based on the background (e.g. "home office", "bedroom", "kitchen", "car", "coffee shop"). If the background is too blurry or generic to tell, use null.
Example: {"person":["man, 30s","gym build","wearing a backwards cap","smirking","leaning back"],"setting":"home office"}
Keep it compact. Return ONLY the JSON object.` },
            ],
          },
        ],
        config: { thinkingConfig: { thinkingBudget: 0 }, maxOutputTokens: 500 },
      });
      const text = response.text ?? "{}";
      recordGeminiUsage({
        route: "analyze-vision",
        model: VISION_MODEL,
        text,
        userText: "vision observations",
        imageCount: 1,
        usageMetadata: response.usageMetadata,
      });
      const parsed = extractJson<{ person?: string[]; setting?: string | null }>(text, /\{[\s\S]*\}/, {});
      const observations = Array.isArray(parsed.person) ? parsed.person.filter((s) => typeof s === "string") : [];
      const setting = typeof parsed.setting === "string" ? parsed.setting : null;
      return NextResponse.json({ sentences: [], observations, setting });
    }

    const systemPrompt =
      mode === "greeting"
        ? getGreetingSystemPrompt(personaId)
        : getRoastSystemPrompt(burnIntensity as BurnIntensity, personaId);

      const response = await generateWithRetry({
      model: VISION_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: "image/jpeg", data: imageBase64 } },
            { text: mode === "greeting" ? "Greet and observe this person!" : "Roast this person based on what you see!" },
          ],
        },
      ],
      config: {
        systemInstruction: systemPrompt,
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 1200,
      },
    });

    const text = response.text ?? "{}";
    recordGeminiUsage({
      route: `analyze-${mode}`,
      model: VISION_MODEL,
      text,
      systemPrompt,
      userText: mode === "greeting" ? "Greet and observe this person!" : "Roast this person based on what you see!",
      imageCount: 1,
      usageMetadata: response.usageMetadata,
    });
    const parsed = extractJson<{ observations?: string[]; sentences?: RoastSentenceRaw[] }>(
      text,
      /\{[\s\S]*\}/,
      {}
    );

    const sentences: RoastSentenceRaw[] = (parsed.sentences ?? []).filter(
      (s) => typeof s.text === "string" && s.text.trim().length > 0
    );
    const observations: string[] = parsed.observations ?? [];

    return NextResponse.json({ sentences, observations });
  } catch (err) {
    const unavailable = toModelUnavailableError(VISION_MODEL, err);
    if (unavailable) {
      console.error("[analyze] MODEL_UNAVAILABLE:", unavailable.failedModel);
      return NextResponse.json(
        {
          error: "model_unavailable",
          failedModel: unavailable.failedModel,
          suggestedFallback: unavailable.suggestedFallback,
        },
        { status: 503 },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[analyze]", message);
    return NextResponse.json({ error: "Analyze API failed", detail: message }, { status: 500 });
  }
}
