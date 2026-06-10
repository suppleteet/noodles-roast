import { NextRequest } from "next/server";
import { getBaseJokePrompt, type BurnIntensity } from "@/lib/prompts";
import { getToastBasePrompt, getToastContextInstructions } from "@/lib/toastPrompts";
import { PERSONA_IDS, DEFAULT_PERSONA, type PersonaId } from "@/lib/personaMetadata";
import type { JokeContext } from "@/app/api/generate-joke/route";

/**
 * Plain-text viewer for the assembled comedian system prompts — the exact
 * `systemInstruction` a chat session is created with (chatSessionStore.ts).
 *
 * Usage:
 *   /api/debug-prompt                          → usage + persona list
 *   /api/debug-prompt?persona=kvetch           → kvetch's session system prompt
 *   /api/debug-prompt?experience=toast         → Toast's session system prompt
 *   ?intensity=1-5  ?contentMode=clean|vulgar  → variants
 *   ?context=answer_roast (toast only)         → append that turn's task preamble
 *
 * Edit the underlying text in src/lib/comedians/<persona>.ts (roast) or
 * src/lib/toastPrompts.ts (toast).
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const personaParam = params.get("persona");
  const experience = params.get("experience") ?? (personaParam ? "roast" : null);

  const intensityRaw = Number(params.get("intensity") ?? 3);
  const intensity = ([1, 2, 3, 4, 5].includes(intensityRaw) ? intensityRaw : 3) as BurnIntensity;
  const contentMode = params.get("contentMode") === "vulgar" ? "vulgar" : "clean";

  const asText = (body: string) =>
    new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });

  if (!experience) {
    return asText(
      [
        "Assembled comedian system prompts (what each chat session is created with).",
        "",
        `Roast personas: ${PERSONA_IDS.join(", ")}`,
        "  /api/debug-prompt?persona=kvetch",
        "Toast:",
        "  /api/debug-prompt?experience=toast",
        "Options: &intensity=1-5  &contentMode=clean|vulgar  &context=<JokeContext> (toast)",
        "",
        "Edit sources: src/lib/comedians/<persona>.ts (roast), src/lib/toastPrompts.ts (toast).",
      ].join("\n"),
    );
  }

  if (experience === "toast") {
    let body = getToastBasePrompt(intensity, contentMode);
    const context = params.get("context");
    if (context) {
      body += `\n\n${"═".repeat(70)}\nPER-TURN INSTRUCTIONS for context "${context}":\n${"═".repeat(70)}\n\n${getToastContextInstructions(context as JokeContext, contentMode)}`;
    }
    return asText(body);
  }

  const persona: PersonaId = PERSONA_IDS.includes(personaParam as PersonaId)
    ? (personaParam as PersonaId)
    : DEFAULT_PERSONA;
  return asText(getBaseJokePrompt(persona, intensity, contentMode));
}
