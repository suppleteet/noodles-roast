import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI, Modality } from "@google/genai";
import { LIVE_MODEL, LIVE_VOICE_NAME } from "@/lib/liveConstants";
import { getLiveSystemPrompt } from "@/lib/livePrompts";
import type { BurnIntensity } from "@/lib/prompts";
import { PERSONA_IDS, DEFAULT_PERSONA, type PersonaId } from "@/lib/personas";

/**
 * Creates an ephemeral auth token for client-side Gemini Live API connections.
 *
 * The token locks the model, system prompt, and voice config server-side so the
 * client can't tamper with them. The API key never leaves the server.
 */
export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY not set" }, { status: 500 });
    }

    const body = await req.json().catch(() => ({}));
    const burnIntensity: BurnIntensity = ([1, 2, 3, 4, 5] as const).includes(body.burnIntensity)
      ? body.burnIntensity
      : 3;

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { apiVersion: "v1alpha" },
    });

    const token = await ai.authTokens.create({
      config: {
        uses: 2, // 1 initial + 1 for session rotation
        expireTime: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5 min
        newSessionExpireTime: new Date(Date.now() + 3 * 60 * 1000).toISOString(), // 3 min
        liveConnectConstraints: {
          model: LIVE_MODEL,
          config: {
            responseModalities: [Modality.AUDIO],
            systemInstruction: getLiveSystemPrompt(burnIntensity),
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: LIVE_VOICE_NAME },
              },
            },
          },
        },
      },
    });

    if (!token.name) {
      return NextResponse.json({ error: "Token creation returned no name" }, { status: 500 });
    }

    return NextResponse.json({ token: token.name });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[live-token]", message);
    return NextResponse.json({ error: "Token creation failed", detail: message }, { status: 500 });
  }
}
