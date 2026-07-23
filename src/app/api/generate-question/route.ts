import { NextRequest, NextResponse } from "next/server";
import { ROAST_MODEL } from "@/lib/constants";
import { PERSONA_IDS, DEFAULT_PERSONA, PERSONAS, type PersonaId } from "@/lib/personas";
import { generateText, type UserPart } from "@/lib/llmClient";
import { ApiRequestError, isValidImageBase64, readLimitedJson } from "@/lib/apiRequest";
import { isRoastModelId } from "@/lib/modelCatalog";

interface GenerateQuestionRequest {
  persona: PersonaId;
  model?: string;
  observations?: string[];
  setting?: string | null;
  knownFacts?: string[];
  conversationSoFar?: string[];
  previousQuestions?: string[];
  /** "open" (default): one natural open question. "simple": closed yes/no or
   *  basic-fact question — nothing open-ended (dev llmQuestions experiment). */
  style?: "open" | "simple";
  imageBase64?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = await readLimitedJson<GenerateQuestionRequest>(req);
    if (body.imageBase64 !== undefined && !isValidImageBase64(body.imageBase64)) {
      return NextResponse.json({ error: "Invalid or oversized image" }, { status: 413 });
    }
    if (body.model !== undefined && !isRoastModelId(body.model)) {
      return NextResponse.json({ error: "Unsupported model" }, { status: 400 });
    }
    const model = body.model ?? ROAST_MODEL;
    const personaId: PersonaId = PERSONA_IDS.includes(body.persona) ? body.persona : DEFAULT_PERSONA;
    const persona = PERSONAS[personaId];

    let systemPrompt = `You are "${persona.name}".
Character voice: ${persona.toneDescription}

Your job: generate ONE short, natural question to ask the person on camera.

RULES:
- The question must feel like a natural next thing to say in a conversation — NOT like a game show or dating questionnaire.
- React to what you SEE if you can. If they're in an office: "So what do you do in that office?" If they're in a car: "Where are you headed?" If you can't tell where they are: "Where are you right now?"
- If you already know things about them (KNOWN FACTS), ask something that builds on what you've learned — not something you already know.
- A current_location fact only means where they appear to be right now. It is NOT where they live, grew up, or are from; you may still ask about home/origin if the user has not answered that.
- ABSOLUTELY DO NOT re-ask about a topic you have already asked about (see ALREADY ASKED list). Even a rephrasing of the same subject is forbidden — if you already asked about the posters, the wall art, the room decor, anything in that vicinity, that ENTIRE TOPIC is dead. Pick a different subject from what you see or a fresh personal angle (their clothing, their face, their voice, their job, their hometown, their hobbies, the lighting, the time of day, what they're holding, etc.).
- Keep it SHORT. One sentence max. Casual, conversational tone.
- Easy to answer — don't ask deep philosophical questions or anything that requires a long explanation.
- The question should set up roastable material — whatever they answer, you should be able to make fun of it.
- NEVER ask multiple-choice or "A or B" style questions ("are you X or Y?", "is that work or fun?"). They feel like a quiz and there's no funny way to answer most of them. Ask one open question.
- Don't anchor on the previous answer. Change topics — pick something new from what you SEE or a fresh personal angle. Building on the last answer locks the show on a weak premise.
- Stay in character.

BAD examples (too formal, too game-show):
- "What's something you're most proud of?"
- "If you could have one superpower, what would it be?"
- "What's something you do that you'd never admit to anyone?"
- "Are you a morning person or a night owl?"   (multiple choice)
- "Is that your office or your home?"          (multiple choice)
- "So you're a teacher — what grade?"          (anchored on previous answer)

GOOD examples (natural, observational, easy):
- "What's going on back there, where are you?"
- "So what do you do in that office?"
- "Is that your place or are you at work?"
- "You got any pets?"
- "What are you up to tonight?"
- "Where are you headed?"
- "Who's that behind you?"
- "What are you drinking?"

Return ONLY a JSON object: { "question": "the question text", "jokeContext": "hint for roasting their answer" }`;

    // "simple" style (dev llmQuestions experiment): closed, low-effort questions.
    if (body.style === "simple") {
      systemPrompt = `You are "${persona.name}".
Character voice: ${persona.toneDescription}

Your job: generate ONE short, SIMPLE question to ask the person on camera.

RULES:
- Ask a CLOSED, low-effort question: a yes/no, or a basic fact they can answer in one or two words. Things like: "You married?", "Got any kids?", "Dog person?", "You work from home?", "You drive?", "From around here?", "You a coffee drinker?", "Live alone?".
- NOTHING open-ended. NOTHING they'd have to think hard about or explain. No "tell me about…", no "what's the story with…", no feelings, no philosophy, no favorites that require deliberation.
- React to what you SEE or build naturally on what you already know — but DO NOT re-ask anything already answered (see WHAT YOU ALREADY KNOW) or any topic in ALREADY ASKED. If they told you they're married, NEVER ask if they're married. Pick a genuinely new fact.
- A current_location fact only means where they appear to be right now. It is NOT where they live, grew up, or are from; do not treat it as an answered home/origin question.
- ONE short sentence. Casual, in character. Whatever they answer, you should be able to roast it.

BAD (open-ended / too much thought):
- "What do you do for fun?"   (open)
- "Tell me about your job."   (open)
- "What's your proudest moment?"  (deep)

GOOD (simple, closed, fast):
- "You married?"
- "Any kids?"
- "Cat or dog person?"
- "You work from home?"
- "You from around here?"

Return ONLY a JSON object: { "question": "the question text", "jokeContext": "hint for roasting their answer" }`;
    }

    const userParts: UserPart[] = [];

    const contextLines: string[] = [];
    if (body.observations?.length)
      contextLines.push(`WHAT YOU SEE: ${body.observations.join("; ")}`);
    if (body.setting)
      contextLines.push(`VISIBLE SETTING: ${body.setting} (where they appear to be right now; not necessarily home or work)`);
    if (body.knownFacts?.length)
      contextLines.push(`WHAT YOU ALREADY KNOW (don't ask about these, except current_location is only current whereabouts, not residence/origin): ${body.knownFacts.join(", ")}`);
    if (body.previousQuestions?.length) {
      // Hard list of dead topics. The prompt rule above forbids any rephrasing of these.
      contextLines.push(
        `ALREADY ASKED (FORBIDDEN — DO NOT rephrase or revisit any of these subjects):\n` +
          body.previousQuestions.map((q) => `- ${q}`).join("\n"),
      );
    }
    if (body.conversationSoFar?.length)
      contextLines.push(`RECENT CONVERSATION:\n${body.conversationSoFar.slice(-4).join("\n")}`);

    userParts.push({ text: contextLines.length > 0 ? contextLines.join("\n\n") : "Generate a natural question." });

    if (body.imageBase64) {
      userParts.push({ inlineData: { mimeType: "image/jpeg", data: body.imageBase64 } });
    }

    const rawText = await generateText({
      model,
      systemPrompt,
      userParts,
      maxOutputTokens: 120,
      forceJsonObject: true,
    });

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      // `fallback: true` tells the brain this is the canned safety line, not a
      // real generated question — divert to a fresh bank question so the puppet
      // never recites the generic "So what's going on with you?" (reads canned).
      return NextResponse.json({ question: "So what's going on with you?", jokeContext: "General roast.", fallback: true });
    }

    const parsed = JSON.parse(jsonMatch[0]) as { question?: string; jokeContext?: string };
    const parsedFailed = !parsed.question;
    const rawQuestion = parsed.question ?? "So what's going on with you?";

    // Hard cap — same rationale as /api/rephrase-question. In-character LLMs love to pad
    // questions with preambles ("So rather than wasting my time...") and tails ("...and don't
    // bullshit me"). If the result blows past the cap, replace with a stripped-down fallback
    // so the puppet doesn't recite a paragraph.
    const MAX_QUESTION_WORDS = 15;
    const wc = rawQuestion.trim().split(/\s+/).filter(Boolean).length;
    const tooLong = wc > MAX_QUESTION_WORDS;
    const question = tooLong ? "So what's going on with you?" : rawQuestion;
    if (tooLong) {
      console.warn(
        `[generate-question] LLM exceeded ${MAX_QUESTION_WORDS}-word cap (${wc}w) — using fallback. raw="${rawQuestion.slice(0, 120)}"`,
      );
    }

    return NextResponse.json({
      question,
      jokeContext: parsed.jokeContext ?? "General roast.",
      // Either path landed on the canned line — let the brain divert to a bank question.
      fallback: parsedFailed || tooLong,
    });
  } catch (err) {
    if (err instanceof ApiRequestError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[generate-question]", err);
    return NextResponse.json({ question: "So what's going on with you?", jokeContext: "General roast.", fallback: true });
  }
}
