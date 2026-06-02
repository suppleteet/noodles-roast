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
// Spoken (with "..." breath padding) to cover the 1-4s the LLM takes to write a
// roast, so there's never dead air. Each entry MUST lead with a soft/voiced
// sound (vowel, m/n hum, "Ah/Oh/Yeah") — a lone hard consonant after the "..."
// pause makes ElevenLabs spike the attack (e.g. "Gotcha." → a loud percussive "G!").
export const NONWORD_FILLERS = [
  "Mm, okay.",
  "Hm, alright.",
  "Uh-huh, sure.",
  "Right, right.",
  "I see.",
  "Okay then.",
  "Yeah, alright.",
  "Ah, gotcha.",
];

// Echo fillers — repeat the user's whole answer once, then bridge into the joke.
// Keep these declarative (not question-shaped) so they sound like active listening.
export const ECHO_FILLER_TEMPLATES = [
  "{answer}, huh.",
  "{answer}, you say.",
  "{answer}. Hm.",
];

/** Chance (0-1) of using an echo filler instead of a non-word filler when eligible. */
export const ECHO_FILLER_PROBABILITY = 0.35;

// ─── Quick acks between Rapid Fire questions ────────────────────────────────
// In Rapid Fire the puppet collects a few answers behind these one-word acks,
// THEN drops one combined joke burst. Keep them short and upbeat.
export const RAPID_FIRE_ACKS = [
  "Got it.", "Okay.", "Nice.", "Mm-hm.", "Right.", "Sure.", "Noted.", "Alright.", "Love it.",
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

// ─── Wrap-up / closing ──────────────────────────────────────────────────────
/** Spoken if the LLM closing line fails to generate. */
export const WRAPUP_FALLBACK = "And on that note, we're done here. Goodnight.";

/** Spoken immediately on entering wrap-up, to cover the ~2-3s the closing line takes. */
export const WRAPUP_BRIDGES = [
  "Alright, alright, before I go —",
  "Welllll, on that note —",
  "Anyway, one last thing —",
  "Okay, last word and I'm out —",
  "Right, before I peace out —",
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
