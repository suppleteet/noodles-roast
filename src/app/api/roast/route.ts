import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { getRoastSystemPrompt, getGreetingSystemPrompt } from "@/lib/prompts";
import { VISION_MODEL } from "@/lib/constants";
import { extractJson } from "@/lib/jsonUtils";
import type { BurnIntensity } from "@/lib/prompts";
import { recordGeminiUsage } from "@/lib/usageTracker";
import { geminiThinkingConfig } from "@/lib/geminiThinking";
import { ApiRequestError, readLimitedJson } from "@/lib/apiRequest";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

type RoastSentenceRaw = { text: string; motion: string; intensity: number };

export async function POST(req: NextRequest) {
  try {
    const body = await readLimitedJson<{
      scene?: unknown;
      burnIntensity?: unknown;
      mode?: unknown;
    }>(req, 250_000);
    if (!body.scene || typeof body.scene !== "object" || Array.isArray(body.scene)) {
      return NextResponse.json({ error: "scene required" }, { status: 400 });
    }
    const scene = body.scene;
    const burnIntensity: BurnIntensity = ([1, 2, 3, 4, 5] as const).includes(
      body.burnIntensity as BurnIntensity,
    ) ? (body.burnIntensity as BurnIntensity) : 3;
    const mode = body.mode === "greeting" ? "greeting" : "roast";

    const systemPrompt = mode === "greeting"
      ? getGreetingSystemPrompt()
      : getRoastSystemPrompt(burnIntensity as BurnIntensity);

    const response = await ai.models.generateContent({
      model: VISION_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Here is the scene description:\n${JSON.stringify(scene, null, 2)}\n\nRoast this person!`,
            },
          ],
        },
      ],
      config: {
        systemInstruction: systemPrompt,
        thinkingConfig: geminiThinkingConfig(VISION_MODEL, "creative"),
        maxOutputTokens: 800,
      },
    });

    const text = response.text ?? "[]";
    recordGeminiUsage({
      route: "roast",
      model: VISION_MODEL,
      text,
      systemPrompt,
      userText: `Here is the scene description:\n${JSON.stringify(scene, null, 2)}\n\nRoast this person!`,
      usageMetadata: response.usageMetadata,
    });
    const fallback: RoastSentenceRaw[] = [{ text, motion: "smug", intensity: 0.7 }];
    const sentences = extractJson<RoastSentenceRaw[]>(text, /\[[\s\S]*\]/, fallback);

    return NextResponse.json({ sentences });
  } catch (err) {
    if (err instanceof ApiRequestError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[roast]", err);
    return NextResponse.json({ error: "Roast API failed" }, { status: 500 });
  }
}
