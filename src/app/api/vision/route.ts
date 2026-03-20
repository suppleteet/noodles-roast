import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { VISION_SYSTEM_PROMPT } from "@/lib/prompts";
import { VISION_MODEL } from "@/lib/constants";
import { extractJson } from "@/lib/jsonUtils";

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
        maxOutputTokens: 512,
      },
    });

    const text = response.text ?? "{}";
    const sceneJson = extractJson<object>(text, /\{[\s\S]*\}/, { overall_vibe: "unclear" });

    return NextResponse.json({ scene: sceneJson });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[vision]", message);
    return NextResponse.json({ error: "Vision API failed", detail: message }, { status: 500 });
  }
}
