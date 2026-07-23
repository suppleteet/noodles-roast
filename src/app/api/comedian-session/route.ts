import { NextRequest, NextResponse } from "next/server";
import { createSession, deleteSession, warmSession } from "@/lib/chatSessionStore";
import { PERSONA_IDS, DEFAULT_PERSONA, type PersonaId } from "@/lib/personas";
import type { BurnIntensity } from "@/lib/prompts";
import { ApiRequestError, readLimitedJson } from "@/lib/apiRequest";
import { isRoastModelId } from "@/lib/modelCatalog";

/**
 * POST /api/comedian-session — Create a new multi-turn chat session.
 * Returns { sessionId } to be passed on subsequent joke requests.
 *
 * DELETE /api/comedian-session — End a session (cleanup).
 * Body: { sessionId }
 */
export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEY not set" }, { status: 500 });
  }

  let body: {
    persona?: string;
    burnIntensity?: number;
    contentMode?: string;
    model?: string;
    experienceType?: string;
  };
  try {
    body = await readLimitedJson<typeof body>(req, 50_000);
  } catch (error) {
    const status = error instanceof ApiRequestError ? error.status : 400;
    return NextResponse.json({ error: "Invalid request" }, { status });
  }
  if (body.model !== undefined && !isRoastModelId(body.model)) {
    return NextResponse.json({ error: "Unsupported model" }, { status: 400 });
  }

  const persona: PersonaId = PERSONA_IDS.includes(body.persona as PersonaId)
    ? (body.persona as PersonaId)
    : DEFAULT_PERSONA;
  const burnIntensity: BurnIntensity = ([1, 2, 3, 4, 5] as const).includes(
    body.burnIntensity as BurnIntensity,
  )
    ? (body.burnIntensity as BurnIntensity)
    : 3;
  const contentMode = body.contentMode === "vulgar" ? "vulgar" : "clean";
  const experienceType = body.experienceType === "toast" ? "toast" : "roast";

  const sessionId = createSession(
    apiKey,
    persona,
    burnIntensity,
    contentMode,
    body.model,
    experienceType,
  );

  // Prime provider prompt caches with the session's system prompt so the
  // user's first turn isn't paying cold-cache latency. Best-effort, async.
  warmSession(sessionId);

  return NextResponse.json({ sessionId });
}

export async function DELETE(req: NextRequest) {
  let body: { sessionId?: string };
  try {
    body = await readLimitedJson<typeof body>(req, 10_000);
  } catch (error) {
    const status = error instanceof ApiRequestError ? error.status : 400;
    return NextResponse.json({ error: "Invalid request" }, { status });
  }

  if (body.sessionId) {
    deleteSession(body.sessionId);
  }

  return NextResponse.json({ ok: true });
}
