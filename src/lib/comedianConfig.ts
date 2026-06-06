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
  visionIntervalMs: 5000,        // how often vision analyze fires
  greetingVisionTimeoutMs: 5500, // max wait for prefetched vision greeting before a fast generated fallback
  firstSpeechBeatMs: 700,        // reveal puppet, hold silent for this long, THEN start TTS — fade-in (~500ms) finishes plus a beat of "him sitting there" before he talks

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
  wrapupPostLinePauseMs: 2500, // dead air after the closing line finishes — comedian "exits the stage" before fade

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
  skipFiller: false,          // non-word filler ("Mmm.", "Uh huh.") bridges silence before joke
  skipScriptedLines: false,   // skip ALL canned speech (bridges, prods, confirm templates, reject templates)
  singleJokeMode: false,     // false: 1-2 jokes stream from one API call; true: pipeline 1 joke at a time

  // Filler pump — keeps audio flowing while the joke generates so there are no long pauses.
  // We add the breath beat ourselves (fillerBreathMs of real silence before each filler)
  // rather than baking a leading "..." into the text — EL rendered the ellipsis flatly and
  // spiked the attack on the word after it. The pump waits this long, then queues the filler.
  fillerBreathMs: 240,
  // Cap is also the user-facing dead-air budget when the LLM hangs: at ~2-3s per filler,
  // a stack of 4 ≈ 10s of fillers before the 13s generationTimeoutMs watchdog fires. Lower
  // is snappier on hangs but risks a real audible pause for slow-but-healthy generations.
  fillerMaxStack: 4,

  // Rapid Fire burst — ask this many short questions back-to-back (each with only a quick
  // one-word ack), THEN drop one joke burst that ties all the answers together. This is what
  // makes Rapid Fire feel distinct from the original question→joke→question cadence.
  // 2 = a joke after every couple questions (snappy); raise it for longer question runs.
  rapidFireBurstSize: 2,

  // Chance (0-1) that a Rapid Fire question drops the user's name in once it's known
  // ("Are you single, Tyler?"). 0 = never, 1 = every question.
  rapidFireNameInjectionChance: 0.45,

  // Generation watchdog — if the joke-generation request (generate-speak) produces no joke
  // within this window, abort it and deliver a canned fallback roast so the puppet never
  // strands the user in dead silence. Sized to fire just as the filler stack (~12.5s for 6
  // fillers) exhausts, so the fallback lands with minimal dead air. A healthy generation
  // delivers its first joke in 1-4s, well inside this window — so it never false-fires.
  generationTimeoutMs: 13_000,
};

const windowOverride =
  typeof window !== "undefined"
    ? (
        window as { __COMEDIAN_CONFIG__?: Partial<typeof defaults> }
      ).__COMEDIAN_CONFIG__
    : undefined;

export const COMEDIAN_CONFIG: typeof defaults = { ...defaults, ...windowOverride };
