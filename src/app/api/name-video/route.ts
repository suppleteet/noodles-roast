/**
 * Generates a clever file-safe video name from the session transcript.
 *
 * Pattern: `Roastie_<2-4 PascalCase tokens, one being the user's name>`
 * Examples (from the spec):
 *   - Roastie_TylerTheShittyPainter
 *   - Roastie_HikingGeraldFairfaxIdiot
 *   - Roastie_MoronJohnGetsRoasted
 *
 * If the LLM returns garbage or no transcript exists, falls back to a
 * timestamp-style name so we never block the save-video flow.
 */

import { NextRequest, NextResponse } from "next/server";
import { ROAST_MODEL } from "@/lib/constants";
import { generateText } from "@/lib/llmClient";

interface NameVideoRequest {
  /** Recent transcript lines, role-prefixed (e.g. "puppet: ..." / "user: ...") */
  transcript?: string[];
  /** Known facts the brain extracted (e.g. ["name:Tyler", "job:painter"]) */
  knownFacts?: string[];
  /** Fallback user name when knownFacts doesn't carry one */
  userName?: string | null;
  /** Optional model override (defaults to ROAST_MODEL) */
  model?: string;
}

const MAX_TRANSCRIPT_LINES = 24;

/** Strip everything except [A-Za-z0-9], split CamelCase runs into tokens. */
function tokenize(raw: string): string[] {
  // Split on underscores, spaces, hyphens, and case-boundaries.
  return raw
    .replace(/[^A-Za-z0-9_\s-]/g, "")
    .split(/[_\s-]+/)
    .flatMap((chunk) => chunk.split(/(?=[A-Z])/))
    .filter(Boolean);
}

/** Title-case a single token: "shitty" -> "Shitty". */
function titleCase(tok: string): string {
  if (!tok) return tok;
  return tok[0]!.toUpperCase() + tok.slice(1).toLowerCase();
}

/**
 * Take the LLM's raw response (which may include quotes, prefixes, extra prose)
 * and normalize to `Roastie_<2-4 PascalCase tokens>`. Returns null if it can't
 * be salvaged — caller falls back.
 */
export function sanitizeFilename(raw: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().split(/\r?\n/)[0]?.trim() ?? "";
  if (!trimmed) return null;
  // Strip a leading "Roastie_" if the LLM already prepended it.
  const body = trimmed.replace(/^["']?roastie[_\s-]*/i, "").replace(/["']$/, "");
  const tokens = tokenize(body).slice(0, 4);
  if (tokens.length === 0) return null;
  const pascal = tokens.map(titleCase).join("");
  if (pascal.length < 2 || pascal.length > 64) return null;
  return `Roastie_${pascal}`;
}

function fallbackName(userName?: string | null): string {
  const safeName = (userName ?? "").replace(/[^A-Za-z0-9]/g, "");
  const base = safeName ? titleCase(safeName) : "Anonymous";
  const ts = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 12); // "202605231423"
  return `Roastie_${base}Roast${ts}`;
}

const SYSTEM_PROMPT = `You name a short video file based on a stand-up roast transcript.

OUTPUT FORMAT — strict:
- Start with "Roastie_" then 2-4 words in PascalCase glued together (no spaces, no underscores between the words).
- One of those words MUST be the user's first name if it appears in the transcript or in KNOWN FACTS (tags like "name:Tyler").
- The other 1-3 words riff on something specific that came up — their job, hobby, town, a flaw the comedian roasted, an emotional read on the user, etc.
- Total file-base length 12-64 characters. No spaces, no punctuation, no quotes, no file extension.
- Output ONLY the filename. No prose, no explanation, no markdown.

GOOD examples (pattern, not to copy):
  Roastie_TylerTheShittyPainter
  Roastie_HikingGeraldFairfaxIdiot
  Roastie_MoronJohnGetsRoasted
  Roastie_AlexCriesAboutCrypto
  Roastie_DivorcedDadFromReno

BAD examples (avoid):
  "Roastie_Tyler_Painter" — underscores between descriptor words
  "Roastie TheShitty Painter" — spaces
  Roastie_TheGuyWhoSaidStuff — no user name, too vague
  Roastie_SessionVideo — generic placeholder
  Roastie_TylerTheShittyPainter.mp4 — file extension included
`;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as NameVideoRequest;
    const userName = body.userName ?? null;

    const transcript = (body.transcript ?? []).slice(-MAX_TRANSCRIPT_LINES);
    const knownFacts = body.knownFacts ?? [];

    // If we have neither transcript nor name, skip the LLM — fallback is fine.
    if (transcript.length === 0 && !userName && knownFacts.length === 0) {
      return NextResponse.json({ filename: fallbackName(null), source: "fallback-empty" });
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
      systemPrompt: SYSTEM_PROMPT,
      userParts,
      maxOutputTokens: 40,
      forceJsonObject: false,
    });

    const filename = sanitizeFilename(raw) ?? fallbackName(userName);
    return NextResponse.json({ filename, source: filename === raw ? "llm" : "llm-sanitized" });
  } catch (err) {
    console.error("[name-video] failed:", err);
    return NextResponse.json({ filename: fallbackName(null), source: "error-fallback" });
  }
}
