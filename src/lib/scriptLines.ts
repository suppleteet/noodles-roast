import type { PersonaId } from "@/lib/personas";

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  SCRIPT LINES — every canned thing the puppet says, in ONE editable place.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * These are plain strings. Edit them freely; changes take effect on reload —
 * no other code changes needed. Reorder, reword, add, or delete entries in any
 * array. Keep at least one entry in each array (the brain picks one at random).
 *
 * Anything containing {answer} is a TEMPLATE — {answer} is replaced with what
 * the user just said before it's spoken (e.g. "Tyler, you say.").
 *
 * ── WHERE THE REST OF THE SPOKEN CONTENT LIVES (not in this file) ───────────
 *   • Questions, Original flow ........ src/lib/questionBank.ts
 *   • Questions, Rapid Fire flow ...... src/lib/rapidFireQuestionBank.ts
 *       (each question also carries its own prod lines + vulgar variants)
 *   • Per-persona opening greetings ... src/lib/personas.ts   (greetings: [...])
 *   • Per-persona fallback roasts ..... src/lib/fallbackRoasts.ts
 *   • The actual JOKES ................ written live by the LLM — never canned.
 *   • Cadence knobs (burst size, etc.). src/lib/comedianConfig.ts
 * ────────────────────────────────────────────────────────────────────────────
 */

// ─── Filler while a joke is being written ───────────────────────────────────
// Spoken to cover the 1-4s the LLM takes to write a roast, so there's never dead
// air. The breath beat before each one is added in code (comedianBrain inserts
// COMEDIAN_CONFIG.fillerBreathMs of silence), NOT baked into the text — so no
// leading "..." here. Keep these a touch longer than a single word: a few words
// of "I'm-thinking-about-this" give ElevenLabs enough context to perform them
// with real intonation. Two-word clips render flat/low-energy. Still lead with a
// soft/voiced sound (vowel, m/n hum, "Ah/Oh/Yeah") so the clip onset isn't a
// hard percussive consonant.
export const NONWORD_FILLERS = [
  "Mm, okay, let me see here.",
  "Hm, alright, hang on a sec.",
  "Uh-huh, sure, I'm with you.",
  "Right, right, I hear you.",
  "Oh, interesting, okay.",
  "Yeah, alright, give me a beat.",
  "Mm-hm, noted, hold on.",
  "Ah, okay, I see where this is going.",
];

// Echo fillers — repeat the user's whole answer once, then bridge into the joke.
// Keep these declarative (not question-shaped) so they sound like active listening.
export const ECHO_FILLER_TEMPLATES = [
  "{answer}, huh. Okay.",
  "{answer}, you say. Interesting.",
  "{answer}. Hm, alright.",
];

/** Chance (0-1) of using an echo filler instead of a non-word filler when eligible. */
export const ECHO_FILLER_PROBABILITY = 0.35;

// ─── Quick acks between Rapid Fire questions ────────────────────────────────
// In Rapid Fire the puppet collects a few answers behind these one-word acks,
// THEN drops one combined joke burst. Keep them short and upbeat.
export const RAPID_FIRE_ACKS = [
  "Got it.", "Okay.", "Nice.", "Mm-hm.", "Right.", "Sure.", "Noted.", "Alright.", "Love it.",
];

// ─── Rapid Fire instant opener (doubles as the "name" question) ─────────────
// Spoken the INSTANT the session starts — no LLM, no waiting on the camera — so
// there's basically no dead air at the top. It both greets AND asks who they are,
// so the first answer is treated as their name. Vision analysis runs in the
// background meanwhile, feeding the vision jokes that come later.
export const RAPID_FIRE_OPENERS = [
  "Well, hello there. Who am I talking to over here?",
  "Oh, look who it is. So who are you, then?",
  "Alright, alright. Who is this?",
  "Hello, hello. And who do we have here?",
  "There you are. So who am I dealing with?",
];

export const RAPID_FIRE_OPENERS_VULGAR = [
  "Well hello there. Who the hell is this I'm talking to?",
  "Oh good. So who the hell are you, then?",
  "Alright, who the hell am I talking to over there?",
  "Well, look at this. Who the hell is this?",
  "There you are. So who the hell are you?",
];

// ─── Bridges into the next question ─────────────────────────────────────────
// A short lead-in spoken before a question so it doesn't feel abrupt.
export const QUESTION_BRIDGES = [
  "Okay.", "Alright.", "Anyway.", "Moving on.", "But seriously.",
  "So.", "Now.", "Let me ask you this.", "Okay okay.",
];

// ─── Answer confirmation / rejection (Original flow only) ───────────────────
// When the puppet half-hears an answer it echoes it back to confirm.
/** Short skeptical beat appended after the confirm echo — gives the user a beat to correct. */
export const CONFIRM_TAIL_FILLERS = [
  "Hmm.",
  "Mmkay.",
  "Right?",
  "Got it.",
];

/** Echo templates — puppet repeats the heard answer back as a check. */
export const DEFAULT_CONFIRM_ECHO_TEMPLATES = [
  "{answer}?",
  "So — {answer}.",
  "{answer}.",
  "{answer}, huh?",
];

/** @deprecated alias kept for older imports. */
export const DEFAULT_CONFIRM_TEMPLATES = DEFAULT_CONFIRM_ECHO_TEMPLATES;

/** Spoken when the puppet can't make out the answer at all and needs a re-do. */
export const REJECT_TEMPLATES = [
  "I didn't catch that. Say again?",
  "What was that?",
  "One more time.",
  "Sorry — say that again?",
];

/** Spoken when the mic picked up the puppet's OWN last line echoing back. */
export const ECHO_REJECTION_TEMPLATES = [
  "That's my line — I need a real answer, not the joke echoing back.",
  "You can't just repeat what I said — give me an actual answer.",
  "The mic picked up my voice, not yours — try again.",
];

/** Spoken when the user denies the puppet's confirmation guess. */
export const CONFIRM_DENIED_LINE = "One more time?";

// ─── Fallback roasts (only used when the LLM returns nothing) ────────────────
// Generic save-the-moment lines so the puppet never goes silent after an answer.
export const ANSWER_FALLBACK_ROASTS = [
  "Stunning. Real edge-of-my-seat material there.",
  "Yeah. The roast practically writes itself.",
  "Riveting. Honestly, give me a second to recover.",
  "Cool. Cool cool cool. Anyway.",
  "Mhm. Just stunning material to work with.",
  "Wow. The depth on display here is staggering.",
  "Sure. Let's just keep moving.",
];

/** Spoken if the very first greeting/vision joke fails to generate. */
export const GREETING_FALLBACK = "The camera took one look and requested hazard pay.";

// ─── Technical-difficulties exit ────────────────────────────────────────────
/** Spoken when the joke-generation watchdog fires — the LLM hung past
 *  COMEDIAN_CONFIG.generationTimeoutMs and the puppet is about to fall back to
 *  canned filler indefinitely. Better to admit it's broken in character and
 *  end the session than grind through more dead air. Per-persona so the
 *  goodbye sounds like the puppet, not a corporate error message.
 *  Length: keep to ~15-22 words — enough to land "something broke, come back
 *  later" without dragging out the awkward moment. */
export const TECHNICAL_DIFFICULTIES_LINES: Record<PersonaId, string[]> = {
  kvetch: [
    "Oy. My brain just stopped. Look, this is on me, not you — try this again later, kid.",
    "Hold on. No, it's gone — the lights are flickering up here. Come back later, please.",
    "Something just snapped in my head. We're done. I'm sorry, try me again later.",
  ],
  hype: [
    "AY — my brain just CRASHED on me, I am OUT. Hit me up later, alright? We'll go again.",
    "Yo my circuits just went DOWN, I cannot do this right now. Catch me later.",
    "NOPE. Something just snapped up here. We're done, come back to me, we'll run this back.",
  ],
  sweetheart: [
    "Oh no... my brain just stopped working. I'm so sorry. Try me again later, okay?",
    "Sweetie, something just broke in my head. This isn't your fault. Come back another time.",
    "Oh honey — I think I just lost it. Let's pick this up later. I'm sorry.",
  ],
  menace: [
    "Hold up — my brain just ate itself. We're done here. Come back when I'm working.",
    "Yeah, no. Something just went sideways up here. Try me later, we'll have a worse time.",
    "My circuits just took a personal day. We're tapping out. Try me again later.",
  ],
};

// ─── Toastie experience: scripted lines ─────────────────────────────────────
/** Toastie's mid-thought greetings — she's already been talking to someone
 *  offstage and pivots to the camera. The user feels like they walked in on
 *  her toast already in progress. */
export const TOASTIE_GREETINGS = [
  "…and THEN, AND THEN — oh! Hi! Sorry, you must be the guest of honor.",
  "…I'm just SAYING, that's all I'm saying. *clink* — okay, hi! Hi gorgeous.",
  "…and that is EXACTLY what I told her. Oh — hello! Look at this face.",
  "…anyway, anyway, ANYWAY — oh god, sorry, you're here, hi!",
  "Okay okay, settle down, everyone — *clink* — there you are, sweetie!",
];

/** Drunk-thinking fillers — same role as NONWORD_FILLERS but in Toastie's
 *  voice. Slightly meandering, warmer, hint at champagne. */
export const TOASTIE_FILLER_LINES = [
  "Hmm, where was I, where was I.",
  "Oh god, hold on, let me think.",
  "Wait wait wait, lemme — yeah, yeah.",
  "Okay so, hold that thought.",
  "Mm, yeah, no, totally, totally.",
  "Right, right, okay, *sip*.",
  "Oh that's good, okay, hang on.",
];

/** Toastie's version of the watchdog goodbye — drunk apologetic, ends the
 *  session in voice. */
export const TOASTIE_TECHNICAL_DIFFICULTIES_LINES = [
  "Oh god, I am WAY too drunk for this. Sweetie, come back when I've sobered up.",
  "Oh shit — my brain just left the building. Try me again later, gorgeous, I'm sorry.",
  "Okay, okay, I gotta — I gotta sit down for a sec. Come back later, I LOVE YOU.",
];

/** Toastie's answer-fallback roasts — generic save-the-moment lines used
 *  only when the LLM returns nothing for an answer cycle. Warmer + drunker
 *  than ANSWER_FALLBACK_ROASTS. */
export const TOASTIE_ANSWER_FALLBACK_ROASTS = [
  "I love that. Truly. I have no notes.",
  "Iconic. Honestly, iconic. *clink*",
  "Okay okay okay. We love that for you.",
  "Stunning. Stunning answer. Stunning energy.",
  "Yes. YES. I am writing that down.",
];

// ─── Wrap-up / closing ──────────────────────────────────────────────────────
/** Spoken if the LLM closing line fails to generate. */
export const WRAPUP_FALLBACK = "And on that note, we're done here. Goodnight.";

/** Spoken immediately on entering wrap-up, to cover the ~2-3s the closing line takes.
 *  Kept NEUTRAL (not a goodbye) on purpose — the closing line itself is the sign-off,
 *  so a "before I go..." bridge here would double up the goodbye. Just a short beat. */
export const WRAPUP_BRIDGES = [
  "Okay.",
  "So.",
  "Right then.",
  "Anyway.",
  "Welp.",
];

// ─── Contextual question fallbacks (Original flow, vision-based Q gen) ───────
/** Prod lines for an LLM-generated contextual question. */
export const CONTEXTUAL_QUESTION_PRODS = [
  "Come on, I'm waiting.",
  "I asked you a question.",
];

/** Asked if contextual question generation fails entirely. */
export const CONTEXTUAL_FALLBACK_QUESTION = "So where are you right now? What am I looking at back there?";

/** Prod lines for the contextual fallback question above. */
export const CONTEXTUAL_FALLBACK_PRODS = ["Hello? Where are you?", "I'm talking to you."];

// ─── Rhetorical versions (asked when the user can't / won't talk) ───────────
// Keyed by the EXACT original question text. If a question isn't listed, a
// generic rhetorical is built from it automatically.
export const RHETORICAL_QUESTIONS: Record<string, string> = {
  "What's your name?": "I'd ask your name but you can't even talk to me. Let me just look at you instead.",
  "Where are you from?": "I'd ask where you're from but you're the strong silent type. We'll make do.",
  "What do you do for a living?": "I'd ask what you do but you're not exactly forthcoming. I'll use my imagination.",
};

/** Last-resort greeting if a persona somehow has no greetings of its own. */
export const DEFAULT_GREETING = "Hey there!";
