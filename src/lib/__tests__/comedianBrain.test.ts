import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ComedianBrain, type ComedianBrainDeps } from "@/lib/comedianBrain";
import type { BrainState } from "@/lib/comedianBrainConfig";
import { COMEDIAN_CONFIG } from "@/lib/comedianConfig";
import { PERSONAS } from "@/lib/personas";
import type { JokeResponse } from "@/app/api/generate-joke/route";

// Override latency experiment flags so tests run the full greeting/pre_generate flow
vi.mock("@/lib/comedianConfig", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/comedianConfig")>();
  return {
    ...original,
    COMEDIAN_CONFIG: {
      ...original.COMEDIAN_CONFIG,
      skipGreeting: false,
      skipPreGeneration: false,
      skipFiller: false,
      singleJokeMode: false,
    },
  };
});

// ─── Mock fetch ─────────────────────────────────────────────────────────────────

function mockFetchResponse(response: JokeResponse) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(response),
  });
}

const DEFAULT_JOKE_RESPONSE: JokeResponse = {
  relevant: true,
  jokes: [{ text: "You look like a mistake.", motion: "smug", intensity: 0.8, score: 7 }],
};

const IRRELEVANT_RESPONSE: JokeResponse = {
  relevant: false,
  jokes: [],
  redirect: "Nice try. But back to my question —",
};

// ─── Deps factory ──────────────────────────────────────────────────────────────

function makeDeps(overrides?: Partial<ComedianBrainDeps>): ComedianBrainDeps {
  return {
    queueSpeak: vi.fn(),
    cancelSpeech: vi.fn(),
    isQueueEmpty: vi.fn().mockReturnValue(true),
    setMotion: vi.fn(),
    captureFrame: vi.fn().mockReturnValue(undefined),
    getPersona: vi.fn().mockReturnValue("kvetch"),
    getBurnIntensity: vi.fn().mockReturnValue(3),
    getContentMode: vi.fn().mockReturnValue("clean"),
    getRoastModel: vi.fn().mockReturnValue("gemini-3.5-flash"),
    getCannedIntro: vi.fn().mockReturnValue(false),
    getInputAmplitude: vi.fn().mockReturnValue(0.1),
    getObservations: vi.fn().mockReturnValue([]),
    getVisionSetting: vi.fn().mockReturnValue(null),
    getAmbientContext: vi.fn().mockReturnValue(null),
    getTownFlavor: vi.fn().mockReturnValue(null),
    getSessionId: vi.fn().mockReturnValue(null),
    setBrainState: vi.fn(),
    setCurrentQuestion: vi.fn(),
    setUserAnswer: vi.fn(),
    logTiming: vi.fn(),
    ...overrides,
  };
}

/** Extract all brain state transitions from mock calls */
function getStates(deps: ComedianBrainDeps): Array<BrainState | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (deps.setBrainState as ReturnType<typeof vi.fn>).mock.calls.map((c: any[]) => c[0] as BrainState | null);
}

/** Drive brain from start → wait_answer.
 *  Greeting is now LLM-generated (async), so we must flush microtasks. */
async function driveToWaitAnswer(brain: ComedianBrain): Promise<void> {
  brain.start();
  brain.onVisionUpdate([]);   // vision ready → fires greeting generation
  await vi.advanceTimersByTimeAsync(0); // flush microtasks
  brain.onTtsQueueDrained();  // greeting drain → ask_question
  brain.onTtsQueueDrained();  // ask_question → wait_answer
}

// ─── Globals ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetchResponse(DEFAULT_JOKE_RESPONSE));
  vi.stubGlobal("sessionStorage", {
    getItem: vi.fn().mockReturnValue(null),
    setItem: vi.fn(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ─── Greeting tests ──────────────────────────────────────────────────────────

describe("ComedianBrain — start() / greeting", () => {
  it("transitions to greeting state on start()", () => {
    vi.stubGlobal("fetch", mockFetchResponse(DEFAULT_JOKE_RESPONSE));
    const deps = makeDeps();
    const brain = new ComedianBrain(deps);
    brain.start();
    expect(getStates(deps)).toContain("greeting");
  });

  it("generates greeting via LLM (not canned strings)", async () => {
    vi.useFakeTimers();
    const deps = makeDeps();
    const brain = new ComedianBrain(deps);
    brain.start();
    brain.onVisionUpdate([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.queueSpeak).toHaveBeenCalledWith("You look like a mistake.", "smug", 0.8);
  });

  it("isListening() returns false in greeting", () => {
    vi.stubGlobal("fetch", mockFetchResponse(DEFAULT_JOKE_RESPONSE));
    const deps = makeDeps();
    const brain = new ComedianBrain(deps);
    brain.start();
    expect(brain.isListening()).toBe(false);
  });
});

// ─── Vision flow ─────────────────────────────────────────────────────────────

describe("ComedianBrain — vision flow", () => {
  it("advances from greeting when TTS drains AND vision arrives", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetchResponse(DEFAULT_JOKE_RESPONSE));
    const deps = makeDeps();
    const brain = new ComedianBrain(deps);
    brain.start();
    brain.onVisionUpdate([]);
    await vi.advanceTimersByTimeAsync(0);
    brain.onTtsQueueDrained();
    const states = getStates(deps);
    expect(states).toContain("ask_question");
  });

  it("does NOT advance until generation resolves and TTS drains", () => {
    // Greeting generation never resolves — TTS never queued, so drain fires with nothing played.
    // Brain should still advance (greeting TTS drained = true), but queueSpeak should not have been called.
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
    const deps = makeDeps();
    const brain = new ComedianBrain(deps);
    brain.start();
    // No speech queued yet (fetch pending) — queueSpeak not called
    expect(deps.queueSpeak).not.toHaveBeenCalled();
  });

  it("advances to ask_question once greeting TTS drains", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetchResponse(DEFAULT_JOKE_RESPONSE));
    const deps = makeDeps();
    const brain = new ComedianBrain(deps);
    brain.start();
    await vi.advanceTimersByTimeAsync(0); // flush generation
    brain.onTtsQueueDrained();
    const states = getStates(deps);
    expect(states).toContain("ask_question");
  });
});

// ─── Q&A cycle ───────────────────────────────────────────────────────────────

describe("ComedianBrain — Q&A cycle", () => {
  it("reaches wait_answer after full startup flow", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetchResponse(DEFAULT_JOKE_RESPONSE));
    const deps = makeDeps();
    const brain = new ComedianBrain(deps);
    await driveToWaitAnswer(brain);
    expect(getStates(deps)).toContain("wait_answer");
    expect(brain.isListening()).toBe(true);
  });

  it("transitions to wait_answer from ask_question after question TTS drains", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetchResponse(DEFAULT_JOKE_RESPONSE));
    const deps = makeDeps();
    const brain = new ComedianBrain(deps);
    brain.start();
    brain.onVisionUpdate([]);
    await vi.advanceTimersByTimeAsync(0);
    brain.onTtsQueueDrained();
    brain.onTtsQueueDrained();

    const states = getStates(deps);
    expect(states).toContain("ask_question");
    expect(states).toContain("wait_answer");
  });

  it("routes inputTranscription to answerBuffer in wait_answer", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetchResponse(DEFAULT_JOKE_RESPONSE));
    const deps = makeDeps();
    const brain = new ComedianBrain(deps);
    await driveToWaitAnswer(brain);
    brain.onInputTranscription("My name is Mike");
    expect(deps.setUserAnswer).toHaveBeenCalledWith("My name is Mike");
  });

  it("transitions to pre_generate after enough words", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetchResponse(DEFAULT_JOKE_RESPONSE));
    const deps = makeDeps();
    const brain = new ComedianBrain(deps);
    await driveToWaitAnswer(brain);
    brain.onInputTranscription("My name is Mike Johnson"); // 4 words >= 3
    expect(getStates(deps)).toContain("pre_generate");
  });

  it("transitions to generating after silence timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetchResponse(DEFAULT_JOKE_RESPONSE));
    const deps = makeDeps();
    const brain = new ComedianBrain(deps);
    await driveToWaitAnswer(brain);
    brain.onInputTranscription("My name is Mike Johnson plumber");
    vi.advanceTimersByTime(1600);
    expect(getStates(deps)).toContain("generating");
  });

  it("watchdog: a generation hang runs the brain-busted exit and offers a model restart", async () => {
    vi.useFakeTimers();
    const onSessionEnd = vi.fn();
    const onModelTrouble = vi.fn();
    const deps = makeDeps({ onSessionEnd, onModelTrouble });
    const brain = new ComedianBrain(deps);
    await driveToWaitAnswer(brain);
    // generate-speak hangs forever (simulates a Gemini / server stall — a real
    // session died 37s in because its FIRST answer-joke generation hung).
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    brain.onInputTranscription("My name is Mike Johnson plumber");
    vi.advanceTimersByTime(1600); // commit answer → generating
    expect(getStates(deps)).toContain("generating");
    (deps.queueSpeak as ReturnType<typeof vi.fn>).mockClear();

    // Watchdog (generationTimeoutMs): no silent model swap, no canned limp-along.
    // The comedian speaks the in-character busted line and the session wraps up.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(getStates(deps)).toContain("wrapup");
    expect(deps.queueSpeak).toHaveBeenCalled(); // brain-busted line was spoken
    // Controller is told which model failed so it can prompt a different-model restart.
    expect(onModelTrouble).toHaveBeenCalledWith("gemini-3.5-flash");

    // The closing line drains → session ends.
    brain.onTtsQueueDrained();
    expect(onSessionEnd).toHaveBeenCalled();
  });

  it("does not immediately commit an unfinalized sentence starter", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetchResponse(DEFAULT_JOKE_RESPONSE));
    const deps = makeDeps();
    const brain = new ComedianBrain(deps);
    await driveToWaitAnswer(brain);

    brain.onInputTranscription("I");
    vi.advanceTimersByTime(1000);

    expect(getStates(deps)).not.toContain("generating");
  });
});

// ─── Canned intro (instant opener) ─────────────────────────────────────────────

describe("ComedianBrain — canned intro", () => {
  // Default test persona is kvetch — the brain should pull HIS bank.
  const KVETCH_INTROS = PERSONAS.kvetch.cannedIntros;
  const ALL_CLEAN_INTROS = [
    ...KVETCH_INTROS.clean.anytime,
    ...KVETCH_INTROS.clean.early,
    ...KVETCH_INTROS.clean.late,
  ];

  it("speaks an instant canned opener instead of generating an LLM greeting", () => {
    const fetchMock = mockFetchResponse(DEFAULT_JOKE_RESPONSE);
    vi.stubGlobal("fetch", fetchMock);
    const deps = makeDeps({ getCannedIntro: vi.fn().mockReturnValue(true) });
    const brain = new ComedianBrain(deps);
    brain.start();

    const spoken = (deps.queueSpeak as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(ALL_CLEAN_INTROS).toContain(spoken);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats the opener as the name question and advances straight to wait_answer", () => {
    vi.stubGlobal("fetch", mockFetchResponse(DEFAULT_JOKE_RESPONSE));
    const deps = makeDeps({ getCannedIntro: vi.fn().mockReturnValue(true) });
    const brain = new ComedianBrain(deps);
    brain.start();
    brain.onTtsQueueDrained(); // opener finished playing

    const states = getStates(deps);
    expect(states).toContain("wait_answer");
    expect(states).not.toContain("ask_question"); // opener already asked the name
  });

  it("uses vulgar intro lines when contentMode is vulgar", () => {
    vi.stubGlobal("fetch", mockFetchResponse(DEFAULT_JOKE_RESPONSE));
    const deps = makeDeps({
      getCannedIntro: vi.fn().mockReturnValue(true),
      getContentMode: vi.fn().mockReturnValue("vulgar"),
    });
    const brain = new ComedianBrain(deps);
    brain.start();

    const spoken = (deps.queueSpeak as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    const allVulgar = [
      ...KVETCH_INTROS.vulgar.anytime,
      ...KVETCH_INTROS.vulgar.early,
      ...KVETCH_INTROS.vulgar.late,
    ];
    expect(allVulgar).toContain(spoken);
  });

  it("pulls the active persona's bank, not a shared one", () => {
    vi.stubGlobal("fetch", mockFetchResponse(DEFAULT_JOKE_RESPONSE));
    const deps = makeDeps({
      getCannedIntro: vi.fn().mockReturnValue(true),
      getPersona: vi.fn().mockReturnValue("hype"),
    });
    const brain = new ComedianBrain(deps);
    brain.start();

    const spoken = (deps.queueSpeak as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    const hypeClean = [
      ...PERSONAS.hype.cannedIntros.clean.anytime,
      ...PERSONAS.hype.cannedIntros.clean.early,
      ...PERSONAS.hype.cannedIntros.clean.late,
    ];
    expect(hypeClean).toContain(spoken);
  });
});

// ─── Silence handling ─────────────────────────────────────────────────────────

describe("ComedianBrain — silence handling", () => {
  it("transitions to prodding after answerWaitMs silence", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetchResponse(DEFAULT_JOKE_RESPONSE));
    const deps = makeDeps();
    const brain = new ComedianBrain(deps);
    await driveToWaitAnswer(brain);
    vi.advanceTimersByTime(6100);
    expect(getStates(deps)).toContain("prodding");
  });

  it("cancels prod when inputTranscription arrives during prodding", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetchResponse(DEFAULT_JOKE_RESPONSE));
    const deps = makeDeps();
    const brain = new ComedianBrain(deps);
    await driveToWaitAnswer(brain);
    vi.advanceTimersByTime(6100);
    brain.onInputTranscription("Wait I have something to say");
    expect(deps.cancelSpeech).toHaveBeenCalled();
    expect(getStates(deps)).toContain("wait_answer");
  });
});

// ─── Irrelevant answers ───────────────────────────────────────────────────────

describe("ComedianBrain — irrelevant answers", () => {
  it("transitions to redirecting when API returns relevant:false", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetchResponse(DEFAULT_JOKE_RESPONSE));
    const deps = makeDeps();
    const brain = new ComedianBrain(deps);
    await driveToWaitAnswer(brain);
    vi.stubGlobal("fetch", mockFetchResponse(IRRELEVANT_RESPONSE));
    brain.onInputTranscription("My name is something unrelated");
    vi.advanceTimersByTime(600); // trigger silence timer
    // Need to let the async fetch resolve
    await vi.runAllTimersAsync();
    expect(getStates(deps)).toContain("generating");
  });
});

// ─── Stop ────────────────────────────────────────────────────────────────────

describe("ComedianBrain — stop()", () => {
  it("sets brainState to null on stop", () => {
    vi.stubGlobal("fetch", mockFetchResponse(DEFAULT_JOKE_RESPONSE));
    const deps = makeDeps();
    const brain = new ComedianBrain(deps);
    brain.start();
    brain.stop();
    const lastState = getStates(deps).at(-1);
    expect(lastState).toBeNull();
  });
});

// ─── No mic mode ─────────────────────────────────────────────────────────────

describe("ComedianBrain — no mic mode", () => {
  it("isListening() is false when mic unavailable", () => {
    vi.stubGlobal("fetch", mockFetchResponse(DEFAULT_JOKE_RESPONSE));
    const deps = makeDeps();
    const brain = new ComedianBrain(deps);
    brain.setMicAvailable(false);
    brain.start();
    expect(brain.isListening()).toBe(false);
  });
});

// ─── Vision react ─────────────────────────────────────────────────────────────

describe("ComedianBrain — vision react", () => {
  it("enters vision_react when interesting change detected after delivering", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetchResponse(DEFAULT_JOKE_RESPONSE));
    const deps = makeDeps({
      getObservations: vi.fn().mockReturnValue(["a dog appeared on camera"]),
    });
    const brain = new ComedianBrain(deps);
    await driveToWaitAnswer(brain);

    // Simulate user answering and joke being delivered
    brain.onInputTranscription("My name is Alex Johnson from Seattle");
    vi.advanceTimersByTime(600);
    await vi.runAllTimersAsync();

    // Deliver state → check_vision → if interesting → vision_react
    brain.onTtsQueueDrained(); // delivering drains → _onDeliveringDrained → enterCheckVision

    const states = getStates(deps);
    // Check that check_vision was visited
    expect(states).toContain("check_vision");
  });
});

// ─── Answer confirmation ─────────────────────────────────────────────────────

describe("ComedianBrain — answer confirmation", () => {
  it("confirms low-confidence name answer", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetchResponse(DEFAULT_JOKE_RESPONSE));
    const deps = makeDeps();
    const brain = new ComedianBrain(deps);
    await driveToWaitAnswer(brain);

    // Lowercase single word — below name threshold (0.8)
    brain.onInputTranscription("tyler", true);
    vi.advanceTimersByTime(400); // silence timer fires → _onAnswerComplete

    const states = getStates(deps);
    expect(states).toContain("confirm_answer");
    // Echo + tail filler (no explicit "what did you say?")
    expect(deps.queueSpeak).toHaveBeenCalledWith(
      expect.stringMatching(/tyler/i),
      "conspiratorial",
      0.65,
    );
    expect(deps.queueSpeak).toHaveBeenCalledWith(
      expect.stringMatching(/[.?!]$/),
      "thinking",
      0.55,
    );
  });

  it("proceeds without confirmation for high-confidence name", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetchResponse(DEFAULT_JOKE_RESPONSE));
    const deps = makeDeps();
    const brain = new ComedianBrain(deps);
    await driveToWaitAnswer(brain);

    // Capitalized name — above threshold
    brain.onInputTranscription("Tyler", true);
    vi.advanceTimersByTime(400);
    await vi.advanceTimersByTimeAsync(0);

    const states = getStates(deps);
    expect(states).not.toContain("confirm_answer");
    expect(states).toContain("generating");
  });

  it("accepts confirmation with 'yes'", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetchResponse(DEFAULT_JOKE_RESPONSE));
    const deps = makeDeps();
    const brain = new ComedianBrain(deps);
    await driveToWaitAnswer(brain);

    // Trigger confirmation
    brain.onInputTranscription("tyler", true);
    vi.advanceTimersByTime(400);

    // Confirm prompt TTS drains → starts listening
    brain.onTtsQueueDrained();

    // User says yes
    brain.onInputTranscription("yes", true);
    vi.advanceTimersByTime(300); // confirm silence timer

    await vi.advanceTimersByTimeAsync(0);
    const states = getStates(deps);
    expect(states).toContain("generating");
  });

  it("handles deny with correction", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetchResponse(DEFAULT_JOKE_RESPONSE));
    const deps = makeDeps();
    const brain = new ComedianBrain(deps);
    await driveToWaitAnswer(brain);

    // Trigger confirmation
    brain.onInputTranscription("tyler", true);
    vi.advanceTimersByTime(400);
    brain.onTtsQueueDrained(); // confirm prompt plays

    // User corrects: "no, Taylor"
    brain.onInputTranscription("no, Taylor", true);
    vi.advanceTimersByTime(300);

    // Should re-confirm with the corrected name
    const states = getStates(deps);
    // Still in confirm_answer (re-confirming)
    expect(states.filter((s) => s === "confirm_answer").length).toBeGreaterThanOrEqual(2);
    expect(deps.queueSpeak).toHaveBeenCalledWith(
      expect.stringMatching(/Taylor/i),
      "conspiratorial",
      0.65,
    );
  });

  it("handles bare deny — returns to ask_question", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetchResponse(DEFAULT_JOKE_RESPONSE));
    const deps = makeDeps();
    const brain = new ComedianBrain(deps);
    await driveToWaitAnswer(brain);

    brain.onInputTranscription("tyler", true);
    vi.advanceTimersByTime(400);
    brain.onTtsQueueDrained();

    brain.onInputTranscription("no", true);
    vi.advanceTimersByTime(300);

    const states = getStates(deps);
    // Should be back in ask_question (waiting for "One more time?" TTS to drain)
    expect(states).toContain("ask_question");
    expect(deps.queueSpeak).toHaveBeenCalledWith("One more time?", "conspiratorial", 0.5);
  });

  it("rejects garbage transcription outright", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetchResponse(DEFAULT_JOKE_RESPONSE));
    const deps = makeDeps();
    const brain = new ComedianBrain(deps);
    await driveToWaitAnswer(brain);

    // Punctuation only — confidence 0.0
    brain.onInputTranscription("...", true);
    vi.advanceTimersByTime(400);

    const states = getStates(deps);
    // Should NOT enter confirm_answer — should go to ask_question (reject)
    expect(states).not.toContain("confirm_answer");
    expect(states).toContain("ask_question");
  });

  it("implicit yes on silence timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetchResponse(DEFAULT_JOKE_RESPONSE));
    const deps = makeDeps();
    const brain = new ComedianBrain(deps);
    await driveToWaitAnswer(brain);

    brain.onInputTranscription("tyler", true);
    vi.advanceTimersByTime(400);
    brain.onTtsQueueDrained(); // confirm prompt plays → starts confirm listen timer

    // No response — wait for confirmTimeoutMs (3000)
    vi.advanceTimersByTime(3100);
    await vi.advanceTimersByTimeAsync(0);

    const states = getStates(deps);
    expect(states).toContain("generating");
  });

  it("VAD speech-end during confirm completes response", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetchResponse(DEFAULT_JOKE_RESPONSE));
    const deps = makeDeps();
    const brain = new ComedianBrain(deps);
    await driveToWaitAnswer(brain);

    brain.onInputTranscription("tyler", true);
    vi.advanceTimersByTime(400);
    brain.onTtsQueueDrained();

    brain.onInputTranscription("yeah", true);
    // VAD fires immediately
    brain.onVadSpeechEnd();

    await vi.advanceTimersByTimeAsync(0);
    const states = getStates(deps);
    expect(states).toContain("generating");
  });

  it("proceeds after maxConfirmAttempts corrections", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetchResponse(DEFAULT_JOKE_RESPONSE));
    const deps = makeDeps();
    const brain = new ComedianBrain(deps);
    await driveToWaitAnswer(brain);

    // First confirm: "tyler" (lowercase, confidence < 0.8)
    brain.onInputTranscription("tyler", true);
    vi.advanceTimersByTime(400);
    brain.onTtsQueueDrained(); // confirm prompt plays

    // First correction: "no, taylor"
    brain.onInputTranscription("no, taylor", true);
    vi.advanceTimersByTime(300);
    // Re-confirms with "taylor" (attempt 2 = maxConfirmAttempts)
    brain.onTtsQueueDrained(); // second confirm prompt plays

    // Second correction: "no, tayla" — at max attempts, should proceed
    brain.onInputTranscription("no, tayla", true);
    vi.advanceTimersByTime(300);

    await vi.advanceTimersByTimeAsync(0);
    const states = getStates(deps);
    expect(states).toContain("generating");
  });
});

// ─── Classify confirm response ──────────────────────────────────────────────

describe("ComedianBrain._classifyConfirmResponse", () => {
  it("classifies affirmative responses", () => {
    expect(ComedianBrain._classifyConfirmResponse("yes")).toBe("affirm");
    expect(ComedianBrain._classifyConfirmResponse("Yeah")).toBe("affirm");
    expect(ComedianBrain._classifyConfirmResponse("yep")).toBe("affirm");
    expect(ComedianBrain._classifyConfirmResponse("correct")).toBe("affirm");
    expect(ComedianBrain._classifyConfirmResponse("that's right")).toBe("affirm");
    expect(ComedianBrain._classifyConfirmResponse("mhm")).toBe("affirm");
  });

  it("classifies bare denials", () => {
    expect(ComedianBrain._classifyConfirmResponse("no")).toBe("deny_bare");
    expect(ComedianBrain._classifyConfirmResponse("nah")).toBe("deny_bare");
    expect(ComedianBrain._classifyConfirmResponse("nope")).toBe("deny_bare");
  });

  it("classifies denials with correction", () => {
    expect(ComedianBrain._classifyConfirmResponse("no, Taylor")).toBe("deny_correction");
    expect(ComedianBrain._classifyConfirmResponse("no it's Taylor")).toBe("deny_correction");
    expect(ComedianBrain._classifyConfirmResponse("nope, my name is Taylor")).toBe("deny_correction");
  });

  it("classifies restatements", () => {
    expect(ComedianBrain._classifyConfirmResponse("Taylor")).toBe("restate");
    expect(ComedianBrain._classifyConfirmResponse("my name is Taylor")).toBe("restate");
  });
});

// ─── Filler picking (echo gated on full answer) ─────────────────────────────

describe("ComedianBrain — filler echo gating", () => {
  /** Drive through to entering `generating`. Returns the first queueSpeak call after entry. */
  async function captureFillerForAnswer(answer: string, randomValue: number): Promise<string> {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetchResponse(DEFAULT_JOKE_RESPONSE));
    const deps = makeDeps();
    const brain = new ComedianBrain(deps);
    await driveToWaitAnswer(brain);
    (deps.queueSpeak as ReturnType<typeof vi.fn>).mockClear();

    // Force the random branch deterministically.
    vi.spyOn(Math, "random").mockReturnValue(randomValue);

    brain.onInputTranscription(answer, true);
    vi.advanceTimersByTime(1600);
    // The filler is queued after a fillerBreathMs breath (a real setTimeout). Fire that timer
    // synchronously — BEFORE awaiting, so the mocked joke fetch can't resolve and stop the pump
    // first — so the captured first queueSpeak is the filler, not the joke.
    vi.advanceTimersByTime(COMEDIAN_CONFIG.fillerBreathMs);
    await vi.runAllTimersAsync();

    // First queueSpeak after answer-complete is the filler.
    const calls = (deps.queueSpeak as ReturnType<typeof vi.fn>).mock.calls;
    return (calls[0]?.[0] as string) ?? "";
  }

  it("echoes a complete short name (random=0 forces echo branch)", async () => {
    const filler = await captureFillerForAnswer("Tyler", 0);
    // Echo template inserts "Tyler" verbatim — must contain it.
    expect(filler.toLowerCase()).toContain("tyler");
  });

  it("uses a non-echo filler when echo probability misses", async () => {
    const filler = await captureFillerForAnswer("Tyler", 0.99);
    expect(filler.toLowerCase()).not.toContain("tyler");
    // No leading "..." anymore — the breath beat is inserted in code (fillerBreathMs of
    // silence) instead of baked into the text. The filler is one of the verbatim non-word lines.
    expect(filler.startsWith("...")).toBe(false);
    // Fillers are now per-persona; this harness runs the default persona (kvetch).
    expect(PERSONAS.kvetch.fillers).toContain(filler);
  });

  // The `fillers` field is required on PersonaConfig, so TS guarantees presence —
  // but an empty array would still typecheck and then crash the picker at runtime
  // (pool[floor(random*0)] → undefined → queueSpeak(undefined)). Guard non-emptiness
  // and the no-leading-"..." rule for every persona's pool.
  it("every persona has a usable filler pool", () => {
    for (const persona of Object.values(PERSONAS)) {
      expect(persona.fillers.length, `${persona.id} fillers`).toBeGreaterThan(0);
      for (const line of persona.fillers) {
        expect(line.trim().length, `${persona.id} filler "${line}"`).toBeGreaterThan(0);
        expect(line.startsWith("..."), `${persona.id} filler "${line}"`).toBe(false);
      }
    }
  });

  it("does not echo a dangling half-sentence even when random=0", async () => {
    // "I'm a software engineer at" ends with a preposition — should not echo.
    const filler = await captureFillerForAnswer("I'm a software engineer at", 0);
    expect(filler.toLowerCase()).not.toContain("software engineer at");
  });

  it("echoes a sentence-terminated short answer (random=0)", async () => {
    // 3 words, ends in period → echo-eligible (cap is 4 words to keep fillers brief).
    const filler = await captureFillerForAnswer("Just a baker.", 0);
    expect(filler.toLowerCase()).toContain("baker");
  });

  it("does NOT echo a long answer — falls back to non-word filler", async () => {
    // 5+ words, sentence-terminated. Used to be echoed (limit was 8 words) but the
    // result ("I work at a bakery, you say.") read as the puppet reciting the answer
    // back, not as a brief filler. Cap is now 4 words.
    const filler = await captureFillerForAnswer("I work at a small bakery.", 0);
    expect(filler.toLowerCase()).not.toContain("bakery");
  });

  it("does NOT echo a vulgar answer — voice renders profanity harshly", () => {
    // Test the predicate directly: captureFillerForAnswer routes "Fuck you." through the
    // name-question confirm path (short hostile reply), not the echo gate. Calling the
    // private gate directly is cleaner than orchestrating a non-confirmed question slot.
    const brain = new ComedianBrain(makeDeps()) as unknown as {
      _isFillerEchoable: (s: string) => boolean;
    };
    expect(brain._isFillerEchoable("Fuck you.")).toBe(false);
    expect(brain._isFillerEchoable("I just jerk off all night.")).toBe(false);
    expect(brain._isFillerEchoable("Shit.")).toBe(false);
  });

  it("does not echo a meta-complaint about the comedian repeating itself", async () => {
    // "You keep asking about the posters." — if echoed back, the puppet sounds
    // broken ("You keep asking about the posters, you say."). Must fall back to non-word filler.
    const a = await captureFillerForAnswer("You keep asking about the posters.", 0);
    expect(a.toLowerCase()).not.toContain("posters");
    const b = await captureFillerForAnswer("You already asked me that.", 0);
    expect(b.toLowerCase()).not.toContain("asked");
    expect(b.toLowerCase()).not.toContain("already");
  });

  it("removes a repeated answer lead from a joke after echo filler", () => {
    const brain = new ComedianBrain(makeDeps()) as unknown as {
      _removeEchoedAnswerLead: (text: string, answer: string, filler?: string) => string;
    };

    expect(
      brain._removeEchoedAnswerLead(
        "Gerard. Nobody under sixty has that name by accident.",
        "Gerard.",
        "Gerard, huh.",
      ),
    ).toBe("Nobody under sixty has that name by accident.");
  });
});

// ─── Interruptible delivering (barge-in to correct mishearings) ─────────────

describe("ComedianBrain — barge-in during delivering", () => {
  /** Drive brain through to delivering state. */
  async function driveToDelivering(brain: ComedianBrain): Promise<void> {
    await driveToWaitAnswer(brain);
    brain.onInputTranscription("My name is Alex", true);
    vi.advanceTimersByTime(1600);
    await vi.runAllTimersAsync();
    // After joke generation resolves, brain transitions to delivering.
  }

  it("substantive speech during delivering cancels TTS and restarts", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetchResponse(DEFAULT_JOKE_RESPONSE));
    const deps = makeDeps();
    const brain = new ComedianBrain(deps);
    await driveToDelivering(brain);

    (deps.cancelSpeech as ReturnType<typeof vi.fn>).mockClear();
    (deps.setBrainState as ReturnType<typeof vi.fn>).mockClear();

    brain.onInputTranscription("No my name is actually Aleks not Alex", true);

    expect(deps.cancelSpeech).toHaveBeenCalled();
    const states = getStates(deps);
    expect(states).toContain("pre_generate");
  });

  it("laughter during delivering does NOT cancel TTS", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetchResponse(DEFAULT_JOKE_RESPONSE));
    const deps = makeDeps();
    const brain = new ComedianBrain(deps);
    await driveToDelivering(brain);

    (deps.cancelSpeech as ReturnType<typeof vi.fn>).mockClear();

    brain.onInputTranscription("haha", true);

    expect(deps.cancelSpeech).not.toHaveBeenCalled();
  });

  it("tiny acknowledgments during delivering do NOT cancel TTS", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetchResponse(DEFAULT_JOKE_RESPONSE));
    const deps = makeDeps();
    const brain = new ComedianBrain(deps);
    await driveToDelivering(brain);

    (deps.cancelSpeech as ReturnType<typeof vi.fn>).mockClear();

    brain.onInputTranscription("yeah", true);
    brain.onInputTranscription("wow", true);
    brain.onInputTranscription("oh", true);

    expect(deps.cancelSpeech).not.toHaveBeenCalled();
  });

  it("explicit correction cue interrupts even at 2 words", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetchResponse(DEFAULT_JOKE_RESPONSE));
    const deps = makeDeps();
    const brain = new ComedianBrain(deps);
    await driveToDelivering(brain);

    (deps.cancelSpeech as ReturnType<typeof vi.fn>).mockClear();

    brain.onInputTranscription("no Aleks", true);

    expect(deps.cancelSpeech).toHaveBeenCalled();
  });
});
