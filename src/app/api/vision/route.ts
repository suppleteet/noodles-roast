import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { VISION_SYSTEM_PROMPT } from "@/lib/prompts";
import { VISION_MODEL } from "@/lib/constants";
import { extractJson } from "@/lib/jsonUtils";
import { recordGeminiUsage } from "@/lib/usageTracker";
import { toModelUnavailableError } from "@/lib/llmClient";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export async function POST(req: NextRequest) {
  try {
    const { imageBase64 } = await req.json();
    if (!imageBase64) {
      return NextResponse.json({ error: "imageBase64 required" }, { status: 400 });
    }

    const response = await ai.models.generateContent({
      model: VISION_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: "image/jpeg", data: imageBase64 } },
            { text: "Describe what you see in this webcam image." },
          ],
        },
      ],
      config: {
        systemInstruction: VISION_SYSTEM_PROMPT,
        // gemini-3.x defaults to internal reasoning before output. With small
        // token budgets the thinking eats the entire budget and the response
        // truncates to broken JSON. Disable for low-latency direct generation.
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 512,
      },
    });

    const text = response.text ?? "{}";
    recordGeminiUsage({
      route: "vision",
      model: VISION_MODEL,
      text,
      systemPrompt: VISION_SYSTEM_PROMPT,
      userText: "Describe what you see in this webcam image.",
      imageCount: 1,
      usageMetadata: response.usageMetadata,
    });
    const sceneJson = extractJson<object>(text, /\{[\s\S]*\}/, { overall_vibe: "unclear" });

    return NextResponse.json({ scene: sceneJson });
  } catch (err) {
    const unavailable = toModelUnavailableError(VISION_MODEL, err);
    if (unavailable) {
      console.error("[vision] MODEL_UNAVAILABLE:", unavailable.failedModel);
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
    console.error("[vision]", message);
    return NextResponse.json({ error: "Vision API failed", detail: message }, { status: 500 });
  }
}
