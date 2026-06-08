/**
 * Generates a clever file-safe video name from the session transcript.
 *
 * Pattern: `<Prefix>_<2-4 PascalCase tokens, one being the user's name>`
 * where the prefix is "Roastie" for roast sessions and "Toastie" for toast
 * sessions. Examples:
 *   - Roastie_TylerTheShittyPainter   (roast)
 *   - Toastie_TylerLovesCryingAtWeddings (toast)
 *
 * If the LLM returns garbage or no transcript exists, falls back to a
 * timestamp-style name so we never block the save-video flow.
 *
 * Pure helpers live in `src/lib/videoNaming.ts` (Next.js route files can only
 * export reserved names, so unit-testable logic stays outside).
 */

import { NextRequest, NextResponse } from "next/server";
import { ROAST_MODEL } from "@/lib/constants";
import { generateText } from "@/lib/llmClient";
import { sanitizeFilename, fallbackName, FILENAME_PREFIX } from "@/lib/videoNaming";

interface NameVideoRequest {
  /** Recent transcript lines, role-prefixed (e.g. "puppet: ..." / "user: ...") */
  transcript?: string[];
  /** Known facts the brain extracted (e.g. ["name:Tyler", "job:painter"]) */
  knownFacts?: string[];
  /** Fallback user name when knownFacts doesn't carry one */
  userName?: string | null;
  /** Optional model override (defaults to ROAST_MODEL) */
  model?: string;
  /** Which experience the user picked — drives the filename prefix
   *  (Roastie_ vs Toastie_). Defaults to "roast" for backwards compat. */
  experienceType?: "roast" | "toast";
}

const MAX_TRANSCRIPT_LINES = 24;

function buildSystemPrompt(experienceType: "roast" | "toast"): string {
  const prefix = FILENAME_PREFIX[experienceType];
  const flavor =
    experienceType === "toast"
      ? `a drunk-woman wedding-style "toast" comedy session`
      : `a stand-up roast transcript`;
  // Examples are tailored per experience so the LLM picks the right vibe.
  const examples =
    experienceType === "toast"
      ? `
GOOD examples (pattern, not to copy):
  Toastie_TylerCriesAboutCrypto
  Toastie_AlexLovesHisCats
  Toastie_DrunkOnATuesdayWithMia
  Toastie_RachelTheChaosWedding
  Toastie_DivorcedDadFromReno

BAD examples (avoid):
  Toastie_TylerSurvivesTheToast — generic / formulaic
  Toastie_SessionVideo — placeholder
  Toastie_TheGuyWhoSaidStuff — no user name`
      : `
GOOD examples (pattern, not to copy):
  Roastie_TylerTheShittyPainter
  Roastie_HikingGeraldFairfaxIdiot
  Roastie_MoronJohnGetsRoasted
  Roastie_AlexCriesAboutCrypto
  Roastie_DivorcedDadFromReno

BAD examples (avoid):
  Roastie_TheGuyWhoSaidStuff — no user name, too vague
  Roastie_SessionVideo — generic placeholder`;

  return `You name a short video file based on ${flavor}.

OUTPUT FORMAT — strict:
- Start with "${prefix}_" then 2-4 words in PascalCase glued together (no spaces, no underscores between the words).
- One of those words MUST be the user's first name if it appears in the transcript or in KNOWN FACTS (tags like "name:Tyler").
- The other 1-3 words riff on something specific that came up — their job, hobby, town, a flaw the comedian roasted, an emotional read on the user, etc.
- Total file-base length 12-64 characters. No spaces, no punctuation, no quotes, no file extension.
- Output ONLY the filename. No prose, no explanation, no markdown.
${examples}
`;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as NameVideoRequest;
    const userName = body.userName ?? null;
    const experienceType: "roast" | "toast" =
      body.experienceType === "toast" ? "toast" : "roast";

    const transcript = (body.transcript ?? []).slice(-MAX_TRANSCRIPT_LINES);
    const knownFacts = body.knownFacts ?? [];

    // If we have neither transcript nor name, skip the LLM — fallback is fine.
    if (transcript.length === 0 && !userName && knownFacts.length === 0) {
      return NextResponse.json({
        filename: fallbackName(null, experienceType),
        source: "fallback-empty",
      });
    }

    const userParts = [
      {
        text: [
          knownFacts.length > 0 ? `KNOWN FACTS: ${knownFacts.join(", ")}` : null,
          transcript.length > 0 ? `TRANSCRIPT (most recent ${transcript.length} lines):\n${transcript.join("\n")}` : null,
          "Now output the filename per the format above. Just the filename, nothing else.",
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ];

    const raw = await generateText({
      model: body.model ?? ROAST_MODEL,
      systemPrompt: buildSystemPrompt(experienceType),
      userParts,
      maxOutputTokens: 40,
      forceJsonObject: false,
    });

    const filename =
      sanitizeFilename(raw, experienceType) ?? fallbackName(userName, experienceType);
    return NextResponse.json({ filename, source: filename === raw ? "llm" : "llm-sanitized" });
  } catch (err) {
    console.error("[name-video] failed:", err);
    return NextResponse.json({ filename: fallbackName(null), source: "error-fallback" });
  }
}
