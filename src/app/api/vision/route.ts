import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { VISION_SYSTEM_PROMPT } from "@/lib/prompts";
import { VISION_MODEL } from "@/lib/constants";
import { extractJson } from "@/lib/jsonUtils";
import { recordGeminiUsage } from "@/lib/usageTracker";
import { toModelUnavailableError } from "@/lib/llmClient";
import { geminiThinkingConfig } from "@/lib/geminiThinking";
import { ApiRequestError, isValidImageBase64, readLimitedJson } from "@/lib/apiRequest";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export async function POST(req: NextRequest) {
  try {
    const body = await readLimitedJson<{ imageBase64?: unknown }>(req);
    if (!isValidImageBase64(body.imageBase64)) {
      return NextResponse.json({ error: "Valid imageBase64 required" }, { status: 400 });
    }
    const imageBase64 = body.imageBase64;

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
        thinkingConfig: geminiThinkingConfig(VISION_MODEL, "realtime-utility"),
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
    if (err instanceof ApiRequestError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
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
    console.error("[vision]", err);
    return NextResponse.json({ error: "Vision API failed" }, { status: 500 });
  }
}
