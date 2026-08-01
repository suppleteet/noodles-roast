/**
 * Comedian Brain — all timing, threshold, and content parameters in one place.
 *
 * Tests inject short timeouts via window.__COMEDIAN_CONFIG__ before page load:
 *   window.__COMEDIAN_CONFIG__ = { answerWaitMs: 80, answerSilenceMs: 30 }
 *
 * No code changes needed — just modify this object.
 */

const defaults = {
  // Timing (milliseconds)
  answerSilenceMs: 300,          // fallback silence timer (Silero VAD is primary, ~150ms)
  unfinalizedAnswerSilenceMs: 1600, // wait longer for trailing STT chunks before committing partial answers
  answerWaitMs: 6000,            // silence before first prod
  earlyListenMs: 1200,           // switch mic to listening this many ms before question ends
  rephraseTimeoutMs: 1200,       // inline question-rephrase race cap. 450ms never beat a cold LLM, so questions shipped generic/impersonal (no name) and read canned. Higher = personalization lands; worst case is this much dead air before the bridged-original fallback.
  transcriptRepairTimeoutMs: 3200, // conservative STT repair; a brief acknowledgement masks the utility call, including occasional cold responses
  visionIntervalMs: 5000,        // how often vision analyze fires
  greetingVisionTimeoutMs: 1500, // max wait for prefetched vision greeting before speaking an instant fallback — the real greeting chains after the fallback when it lands, so firing this is cheap
  firstSpeechBeatMs: 250,        // brief reveal beat before first TTS; keep TTFS low while avoiding an abrupt entrance

  // Behavior
  maxProds: 2,                            // prods before skipping question
  speculativeMinWords: 1,                 // words before firing speculative generation
  hopperMaxSize: 8,                       // max jokes in hopper
  hopperMinScoreForBonus: 8,              // score threshold for unsolicited bonus jokes
  hopperMinScoreForFallback: 6,           // score threshold for silence fallback
  hopperStalenessMs: 60_000,             // evict hopper jokes older than this
  silentQuestionsBeforeVisionMode: 2,     // unanswered Qs before switching to vision-only

  // Content
  jokesPerAnswer: { min: 1, max: 2 },     // how many jokes after each answer
  jokesPerVisionOpen: { min: 1, max: 1 }, // jokes after first vision analysis (keep short, get to Q&A fast)
  callbackOpportunityEveryN: 3,           // check for callbacks every N transitions

  // Greeting pool
  generatedGreetingCount: 4,  // how many AI-generated greetings to pre-generate

  // Session length
  wrapupAfterMs: 180_000,      // after this elapsed, brain routes to wrapup at next ask_question
  wrapupGuardMs: 170_000,      // skip session rotation if elapsed exceeds this — wrapup is imminent
  wrapupPostLinePauseMs: 350,  // short button after the last word; 600ms fade + transition makes stop ≈1s after drain

  // Dev voice notes (gesture-triggered)
  devNotesEnabled: false,      // thumbs-down pauses brain, starts recording; thumbs-up resumes
  devNoteTimeoutMs: 60_000,    // auto-resume after 60s if no thumbs-up

  // Answer confirmation
  confirmationEnabled: true,    // confirm answers when confidence is low
  maxConfirmAttempts: 2,        // max re-confirms before proceeding with best guess
  confirmSilenceMs: 550,        // debounce partial STT chunks before classifying confirm responses
  confirmTimeoutMs: 3000,       // silence after confirm prompt = implicit yes

  // Background noise gating
  inputAmplitudeMin: 0.02,     // minimum mic RMS (0-1) to accept speech — filters distant voices (kids, TV)

  // Latency experiments (temporary)
  skipGreeting: false,         // skip greeting → jump straight to ask_question
  skipPreGeneration: true,    // disabled — speculative LLM calls on partial input added cost without clearly winning TTFR; the brain's dangler/_looksComplete checks (May 2026) are doing the real work
  skipFiller: false,          // short in-character acknowledgement bridges silence before joke
  skipScriptedLines: false,   // skip ALL canned speech (bridges, prods, confirm templates, reject templates)
  singleJokeMode: false,     // false: 1-2 jokes stream from one API call; true: pipeline 1 joke at a time

  // Filler pump — keeps audio flowing while the joke generates so there are no long pauses.
  // We add the breath beat ourselves (fillerBreathMs of real silence before each filler)
  // rather than baking a leading "..." into the text — EL rendered the ellipsis flatly and
  // spiked the attack on the word after it. The pump waits this long, then queues the filler.
  fillerBreathMs: 240,
  // Two lexical acknowledgements cover normal generation without turning one
  // answer into a stack of generic noises. The generation watchdog owns a true
  // provider hang; fillers should preserve character, not conceal ten seconds.
  fillerMaxStack: 2,

  // Generation watchdog — if the joke-generation request (generate-speak) produces no joke
  // within this window, abort it and run the brain-busted exit: the comedian says (in
  // character) that his brain froze, the session ends, and the user is offered a restart
  // with a different model (no silent model swap, no canned limp-along). 8s per Tyler
  // ("if it hangs longer than 8 seconds") — a healthy generation delivers its first joke
  // in 1-4s, well inside this window.
  generationTimeoutMs: 8_000,
};

const windowOverride =
  typeof window !== "undefined"
    ? (
        window as { __COMEDIAN_CONFIG__?: Partial<typeof defaults> }
      ).__COMEDIAN_CONFIG__
    : undefined;

export const COMEDIAN_CONFIG: typeof defaults = { ...defaults, ...windowOverride };
