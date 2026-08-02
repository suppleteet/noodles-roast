import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ComedianBrain, type ComedianBrainDeps } from "@/lib/comedianBrain";
import type { ComedyQuestion } from "@/lib/questionBank";
import type { JokeResponse } from "@/app/api/generate-joke/route";
import { PERSONAS } from "@/lib/personas";
import { VISION_GREETING_BRIDGE } from "@/lib/scriptLines";

// Mock COMEDIAN_CONFIG at module level (evaluated at import time)
vi.mock("@/lib/comedianConfig", () => ({
  COMEDIAN_CONFIG: {
    answerSilenceMs: 30,
    unfinalizedAnswerSilenceMs: 80,
    unfinalizedCompleteSilenceMs: 65,
    lateTranscriptSilenceMs: 90,
    answerWaitMs: 50,
    earlyListenMs: 20,
    visionIntervalMs: 100,
    greetingVisionTimeoutMs: 50,
    maxProds: 1,
    speculativeMinWords: 1,
    hopperMaxSize: 8,
    hopperMinScoreForBonus: 8,
    hopperMinScoreForFallback: 6,
    hopperStalenessMs: 60000,
    silentQuestionsBeforeVisionMode: 2,
    jokesPerAnswer: { min: 1, max: 2 },
    jokesPerVisionOpen: { min: 1, max: 1 },
    callbackOpportunityEveryN: 3,
    generatedGreetingCount: 4,
    rephraseTimeoutMs: 20,
    transcriptRepairTimeoutMs: 100,
    yesNoBranchSelectionWaitMs: 25,
    yesNoBranchPrefetchTimeoutMs: 500,
    firstSpeechBeatMs: 5,
    devNotesEnabled: false,
    devNoteTimeoutMs: 60000,
    skipGreeting: true,
    skipPreGeneration: false,
    skipFiller: false,
    singleJokeMode: true,
    fillerBreathMs: 10,
    fillerMaxStack: 2,
    generationTimeoutMs: 8000,
    ttsFirstAudioTimeoutMs: 2200,
    ttsCompletionTimeoutMs: 7000,
    ttsFallbackTextWaitMs: 1200,
    ttsRestTimeoutMs: 6500,
  },
}));

/** Create mock deps */
function makeDeps(overrides?: Partial<ComedianBrainDeps>): ComedianBrainDeps {
  return {
    queueSpeak: vi.fn(),
    cancelSpeech: vi.fn(),
    isQueueEmpty: vi.fn(() => true),
    setMotion: vi.fn(),
    captureFrame: vi.fn(() => undefined),
    getPersona: vi.fn(() => "kvetch" as const),
    getBurnIntensity: vi.fn(() => 5 as 1 | 2 | 3 | 4 | 5),
    getContentMode: vi.fn(() => "vulgar" as const),
    getRoastModel: vi.fn(() => "gemini-3.5-flash"),
    getCannedIntro: vi.fn(() => false),
    getInputAmplitude: vi.fn(() => 0.1),
    getObservations: vi.fn(() => []),
    getVisionSetting: vi.fn(() => null),
    getAmbientContext: vi.fn(() => null),
    getTownFlavor: vi.fn(() => null),
    getSessionId: vi.fn(() => null),
    setBrainState: vi.fn(),
    setCurrentQuestion: vi.fn(),
    setUserAnswer: vi.fn(),
    logTiming: vi.fn(),
    revealSession: vi.fn(),
    ...overrides,
  };
}

// Mock fetch for API calls the brain makes internally
const mockFetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ jokes: [], relevant: true }),
    text: () => Promise.resolve(""),
    body: null,
  } as unknown as Response),
);

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Helper: get all values passed to setBrainState */
function stateHistory(deps: ComedianBrainDeps): (string | null)[] {
  return (deps.setBrainState as ReturnType<typeof vi.fn>).mock.calls.map(
    (c: unknown[]) => c[0] as string | null,
  );
}

describe("ComedianBrain", () => {
  describe("construction", () => {
    it("creates without error", () => {
      const brain = new ComedianBrain(makeDeps());
      expect(brain).toBeDefined();
    });
  });

  describe("filler delivery", () => {
    it("uses a low-information backchannel instead of echoing the answer", () => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      const brain = new ComedianBrain(makeDeps()) as unknown as {
        _pickFiller: (answer: string) => string;
      };

      const filler = brain._pickFiller("Gerard.");
      expect(filler).toBe(PERSONAS.kvetch.fillers[0]);
      expect(filler).not.toContain("Gerard");
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

  describe("start() with skipGreeting", () => {
    it("transitions to ask_question", () => {
      const deps = makeDeps();
      const brain = new ComedianBrain(deps);
      brain.start();
      expect(stateHistory(deps)).toContain("ask_question");
    });

    it("sets a question once the queued wording is chosen", async () => {
      vi.useFakeTimers();
      const deps = makeDeps();
      const brain = new ComedianBrain(deps);
      brain.start();
      await vi.advanceTimersByTimeAsync(500);
      expect(deps.setCurrentQuestion).toHaveBeenCalled();
      const q = (deps.setCurrentQuestion as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(typeof q).toBe("string");
    });

    it("queues question speech", async () => {
      vi.useFakeTimers();
      const deps = makeDeps();
      const brain = new ComedianBrain(deps);
      brain.start();
      // _queueQuestionWithBridge races rephrase vs timeout — flush microtasks
      await vi.advanceTimersByTimeAsync(1600);
      expect(deps.queueSpeak).toHaveBeenCalled();
    });
  });

  describe("contextual question prefetch", () => {
    it("consumes a camera-triggered contextual prefetch in fixed-bank mode", async () => {
      let resolveQuestion!: (response: Response) => void;
      const pendingQuestion = new Promise<Response>((resolve) => {
        resolveQuestion = resolve;
      });
      const fetchMock = vi.fn((input: RequestInfo | URL) => {
        if (String(input) === "/api/generate-question") return pendingQuestion;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        } as Response);
      });
      vi.stubGlobal("fetch", fetchMock);

      const deps = makeDeps({
        getLlmQuestions: vi.fn(() => false),
        captureFrame: vi.fn(() => "frame"),
      });
      const brain = new ComedianBrain(deps) as unknown as {
        state: string;
        askedQuestionIds: Set<string>;
        bankQuestionsInARow: number;
        cameraAvailable: boolean;
        contextualQuestionRequest: { result: Promise<unknown> } | null;
        _preQueueNextQuestion(): void;
        enterAskQuestion(): void;
      };
      brain.askedQuestionIds.add("name");
      brain.bankQuestionsInARow = 1;
      brain.cameraAvailable = true;
      brain.state = "delivering";

      brain._preQueueNextQuestion();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const request = brain.contextualQuestionRequest;
      expect(request).not.toBeNull();

      brain.enterAskQuestion();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      resolveQuestion({
        ok: true,
        json: () =>
          Promise.resolve({
            question: "What's with that painting?",
            jokeContext: "Wall art roast.",
          }),
      } as Response);
      await pendingQuestion;
      await request?.result;
      await Promise.resolve();

      expect(deps.setCurrentQuestion).toHaveBeenCalledWith("What's with that painting?");
      expect(brain.contextualQuestionRequest).toBeNull();
    });

    it("reuses one in-flight request and does not carry its result into the next cycle", async () => {
      let resolveQuestion!: (response: Response) => void;
      const pendingQuestion = new Promise<Response>((resolve) => {
        resolveQuestion = resolve;
      });
      const fetchMock = vi.fn((input: RequestInfo | URL) => {
        if (String(input) === "/api/generate-question") return pendingQuestion;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        } as Response);
      });
      vi.stubGlobal("fetch", fetchMock);

      const deps = makeDeps({ getLlmQuestions: vi.fn(() => true) });
      const brain = new ComedianBrain(deps) as unknown as {
        state: string;
        askedQuestionIds: Set<string>;
        preQueuedQuestion: ComedyQuestion | null;
        contextualQuestionRequest: {
          result: Promise<unknown>;
        } | null;
        _preQueueNextQuestion(): void;
        enterAskQuestion(): void;
      };
      brain.askedQuestionIds.add("name");
      brain.state = "delivering";

      brain._preQueueNextQuestion();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const firstRequest = brain.contextualQuestionRequest;
      expect(firstRequest).not.toBeNull();

      // Delivery drains before the prefetch resolves. The old implementation
      // started a second request here and let the first result leak forward.
      brain.enterAskQuestion();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      resolveQuestion({
        ok: true,
        json: () =>
          Promise.resolve({
            question: "You live alone?",
            jokeContext: "Living arrangement roast.",
          }),
      } as Response);
      await pendingQuestion;
      await firstRequest?.result;
      await Promise.resolve();

      expect(deps.setCurrentQuestion).toHaveBeenCalledWith("You live alone?");
      expect(deps.queueSpeak).toHaveBeenCalledWith(
        "You live alone?",
        expect.any(String),
        expect.any(Number),
      );
      expect(brain.preQueuedQuestion).toBeNull();
      expect(brain.contextualQuestionRequest).toBeNull();

      // A later cycle starts a genuinely new request; no resolved question is
      // left sitting in preQueuedQuestion to be asked again.
      brain.state = "delivering";
      brain._preQueueNextQuestion();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("aborts and ignores a pending contextual prefetch when the brain stops", async () => {
      let resolveQuestion!: (response: Response) => void;
      let requestSignal: AbortSignal | undefined;
      const pendingQuestion = new Promise<Response>((resolve) => {
        resolveQuestion = resolve;
      });
      vi.stubGlobal(
        "fetch",
        vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
          requestSignal = init?.signal ?? undefined;
          return pendingQuestion;
        }),
      );

      const deps = makeDeps({ getLlmQuestions: vi.fn(() => true) });
      const brain = new ComedianBrain(deps) as unknown as {
        state: string;
        askedQuestionIds: Set<string>;
        _preQueueNextQuestion(): void;
        stop(): void;
      };
      brain.askedQuestionIds.add("name");
      brain.state = "delivering";
      brain._preQueueNextQuestion();

      brain.stop();
      expect(requestSignal?.aborted).toBe(true);

      resolveQuestion({
        ok: true,
        json: () =>
          Promise.resolve({
            question: "This result is stale?",
            jokeContext: "Stale request.",
          }),
      } as Response);
      await pendingQuestion;
      await Promise.resolve();
      await Promise.resolve();

      expect(deps.queueSpeak).not.toHaveBeenCalled();
    });

    it("treats host bridge wording as the same previously asked question", () => {
      const brain = new ComedianBrain(makeDeps()) as unknown as {
        ledger: Array<{
          type: "question";
          text: string;
          timestamp: number;
          tags: string[];
        }>;
        _questionAlreadyAsked(text: string): boolean;
      };
      brain.ledger = [
        {
          type: "question",
          text: "Okay okay. You live alone?",
          timestamp: Date.now(),
          tags: [],
        },
      ];

      expect(brain._questionAlreadyAsked("You live alone?")).toBe(true);
      expect(brain._questionAlreadyAsked("You married?")).toBe(false);
    });
  });

  describe("stop()", () => {
    it("sets brain state to null", () => {
      const deps = makeDeps();
      const brain = new ComedianBrain(deps);
      brain.start();
      brain.stop();
      expect(deps.setBrainState).toHaveBeenCalledWith(null);
    });

    it("disables mic", () => {
      const deps = makeDeps();
      const brain = new ComedianBrain(deps);
      brain.start();
      brain.stop();
      expect(brain.isAudioActive()).toBe(false);
    });
  });

  describe("isListening / isAudioActive", () => {
    it("mic is off before start()", () => {
      const brain = new ComedianBrain(makeDeps());
      expect(brain.isListening()).toBe(false);
      expect(brain.isAudioActive()).toBe(false);
    });

    it("mic is passive in ask_question (skipGreeting)", () => {
      const brain = new ComedianBrain(makeDeps());
      brain.start();
      // ask_question sets mic to passive
      expect(brain.isAudioActive()).toBe(true);
      expect(brain.isListening()).toBe(false);
    });
  });

  describe("onTtsQueueDrained()", () => {
    it("transitions from ask_question to wait_answer", () => {
      const deps = makeDeps();
      const brain = new ComedianBrain(deps);
      brain.start(); // → ask_question
      brain.onTtsQueueDrained(); // question finished → wait_answer
      expect(stateHistory(deps)).toContain("wait_answer");
    });

    it("sets mic to listening in wait_answer", () => {
      const brain = new ComedianBrain(makeDeps());
      brain.start();
      brain.onTtsQueueDrained();
      expect(brain.isListening()).toBe(true);
    });
  });

  describe("onInputTranscription()", () => {
    it("buffers text in wait_answer state", () => {
      const deps = makeDeps();
      const brain = new ComedianBrain(deps);
      brain.start();
      brain.onTtsQueueDrained(); // → wait_answer

      brain.onInputTranscription("Hello");
      expect(deps.setUserAnswer).toHaveBeenCalled();
      const lastCall = (deps.setUserAnswer as ReturnType<typeof vi.fn>).mock.calls.at(-1);
      expect(lastCall?.[0]).toContain("Hello");
    });

    it("transitions to pre_generate when enough words", () => {
      const deps = makeDeps();
      const brain = new ComedianBrain(deps);
      brain.start();
      brain.onTtsQueueDrained(); // → wait_answer

      brain.onInputTranscription("My name is Bob");
      expect(stateHistory(deps)).toContain("pre_generate");
    });

    it("waits longer for unfinalized multi-word answers before generating", async () => {
      vi.useFakeTimers();
      try {
        const deps = makeDeps();
        const brain = new ComedianBrain(deps);
        brain.start();
        brain.onTtsQueueDrained();

        brain.onInputTranscription("I work");
        await vi.advanceTimersByTimeAsync(40);
        expect(stateHistory(deps)).not.toContain("generating");

        brain.onInputTranscription("at a company");
        await vi.advanceTimersByTimeAsync(40);
        expect(stateHistory(deps)).not.toContain("generating");

        await vi.advanceTimersByTimeAsync(80);
        expect(stateHistory(deps)).toContain("generating");
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not immediately commit an unfinalized sentence starter", async () => {
      vi.useFakeTimers();
      try {
        const deps = makeDeps();
        const brain = new ComedianBrain(deps);
        brain.start();
        brain.onTtsQueueDrained();

        brain.onInputTranscription("I");
        await vi.advanceTimersByTimeAsync(40);

        expect(stateHistory(deps)).not.toContain("generating");
      } finally {
        vi.useRealTimers();
      }
    });

    it("ignores empty text", () => {
      const deps = makeDeps();
      const brain = new ComedianBrain(deps);
      brain.start();
      brain.onTtsQueueDrained();

      const callsBefore = (deps.setUserAnswer as ReturnType<typeof vi.fn>).mock.calls.length;
      brain.onInputTranscription("   ");
      const callsAfter = (deps.setUserAnswer as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(callsAfter).toBe(callsBefore);
    });

    it("buffers text during ask_question (early answer)", () => {
      const deps = makeDeps();
      const brain = new ComedianBrain(deps);
      brain.start(); // → ask_question

      brain.activateEarlyListen(); // gate opens once question TTS is nearly done
      brain.onInputTranscription("Tyler");
      expect(deps.setUserAnswer).toHaveBeenCalled();
      expect(deps.logTiming).toHaveBeenCalledWith(
        expect.stringContaining("answer during ask_question"),
      );
    });
  });

  describe("onVadSpeechEnd()", () => {
    it("completes answer when buffer has text", () => {
      const deps = makeDeps();
      const brain = new ComedianBrain(deps);
      brain.start();
      brain.onTtsQueueDrained(); // → wait_answer

      brain.onInputTranscription("Tyler");
      brain.onVadSpeechEnd();

      // Should transition to generating
      expect(stateHistory(deps)).toContain("generating");
    });

    it("defers VAD completion until final STT when answer is 3+ words", () => {
      vi.useFakeTimers();
      try {
        const deps = makeDeps();
        const brain = new ComedianBrain(deps);
        brain.start();
        brain.onTtsQueueDrained(); // → wait_answer

        brain.onInputTranscription("I work in accounting"); // partial / no finished flag yet
        brain.onVadSpeechEnd();
        expect(stateHistory(deps)).not.toContain("generating");

        brain.onInputTranscription("I work in accounting downtown.", true);
        expect(stateHistory(deps)).toContain("generating");
      } finally {
        vi.useRealTimers();
      }
    });

    it("does nothing when buffer is empty", () => {
      const deps = makeDeps();
      const brain = new ComedianBrain(deps);
      brain.start();
      brain.onTtsQueueDrained(); // → wait_answer

      const callsBefore = (deps.setBrainState as ReturnType<typeof vi.fn>).mock.calls.length;
      brain.onVadSpeechEnd();
      expect((deps.setBrainState as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore);
    });

    it("does nothing in wrong state (ask_question)", () => {
      const deps = makeDeps();
      const brain = new ComedianBrain(deps);
      brain.start(); // → ask_question

      const callsBefore = (deps.setBrainState as ReturnType<typeof vi.fn>).mock.calls.length;
      brain.onVadSpeechEnd();
      expect((deps.setBrainState as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore);
    });
  });

  describe("activateEarlyListen()", () => {
    it("switches mic to listening in ask_question state", () => {
      const brain = new ComedianBrain(makeDeps());
      brain.start(); // → ask_question
      expect(brain.isListening()).toBe(false);
      brain.activateEarlyListen();
      expect(brain.isListening()).toBe(true);
    });

    it("does nothing when already listening", () => {
      const brain = new ComedianBrain(makeDeps());
      brain.start();
      brain.onTtsQueueDrained(); // → wait_answer, mic = listening
      expect(brain.isListening()).toBe(true);
      brain.activateEarlyListen(); // should be no-op
      expect(brain.isListening()).toBe(true);
    });
  });

  describe("setMicAvailable / setCameraAvailable", () => {
    it("can be called without error", () => {
      const brain = new ComedianBrain(makeDeps());
      brain.setMicAvailable(true);
      brain.setCameraAvailable(false);
    });
  });

  describe("onInterrupted()", () => {
    it("does not crash in any state", () => {
      const brain = new ComedianBrain(makeDeps());
      brain.start();
      expect(() => brain.onInterrupted()).not.toThrow();
    });
  });

  describe("onVisionUpdate()", () => {
    it("accepts empty observations", () => {
      const brain = new ComedianBrain(makeDeps());
      brain.start();
      expect(() => brain.onVisionUpdate([])).not.toThrow();
    });

    it("accepts observations", () => {
      const brain = new ComedianBrain(makeDeps());
      brain.start();
      expect(() => brain.onVisionUpdate(["wearing glasses", "smiling"])).not.toThrow();
    });
  });

  describe("question voice continuity", () => {
    it("asks questions using the previous joke register instead of fixed emphasis", () => {
      const deps = makeDeps();
      const brain = new ComedianBrain(deps) as unknown as {
        lastJokeMotion: "deadpan";
        lastJokeIntensity: number;
        _queueQuestionWithBridge: (questionText: string) => void;
      };

      brain.lastJokeMotion = "deadpan";
      brain.lastJokeIntensity = 0.42;
      brain._queueQuestionWithBridge("Where are you from?");

      expect(deps.queueSpeak).toHaveBeenCalledWith(
        "Where are you from?",
        "deadpan",
        0.42,
      );
    });
  });

  describe("location handling", () => {
    const whereFromQuestion: ComedyQuestion = {
      id: "where_from",
      question: "Where are you from?",
      jokeContext: "Hometown roast.",
      prodLines: [],
    };

    it("does not treat ambient city as answering where the user is from", () => {
      const brain = new ComedianBrain(makeDeps({
        getAmbientContext: vi.fn(() => ({
          city: "Seattle",
          region: "WA",
          timeOfDay: "afternoon",
          localTime: "2026-06-18T15:00:00-07:00",
        })),
      })) as unknown as {
        shuffledQuestions: ComedyQuestion[];
        questionIndex: number;
        askedQuestionIds: Set<string>;
        _nextValidQuestion: () => ComedyQuestion | null;
      };

      brain.shuffledQuestions = [whereFromQuestion];
      brain.questionIndex = 0;
      brain.askedQuestionIds = new Set();

      expect(brain._nextValidQuestion()?.id).toBe("where_from");
    });

    it("labels geolocation as current_location, not city or hometown", () => {
      const brain = new ComedianBrain(makeDeps({
        getAmbientContext: vi.fn(() => ({
          city: "Seattle",
          region: "WA",
          timeOfDay: "afternoon",
          localTime: "2026-06-18T15:00:00-07:00",
        })),
      })) as unknown as {
        _getThrowbackContext: () => string[];
      };

      const facts = brain._getThrowbackContext();
      expect(facts).toContain("current_location:Seattle");
      expect(facts).not.toContain("city:Seattle");
      expect(facts).not.toContain("hometown:Seattle");
    });

    it("gives punctuated but unfinalized STT a brief grace window", async () => {
      vi.useFakeTimers();
      try {
        const deps = makeDeps();
        const brain = new ComedianBrain(deps);
        brain.start();
        brain.onTtsQueueDrained();

        brain.onInputTranscription("I work in accounting.");
        await vi.advanceTimersByTimeAsync(40);
        expect(stateHistory(deps)).not.toContain("generating");

        await vi.advanceTimersByTimeAsync(25);
        expect(stateHistory(deps)).toContain("generating");
      } finally {
        vi.useRealTimers();
      }
    });

    it("allows a fresh filler after material late STT cancels the old generation", async () => {
      vi.useFakeTimers();
      try {
        // Hold joke generation open so the replacement filler gets a chance to
        // queue instead of the empty-response fallback ending generation first.
        vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
        const deps = makeDeps();
        const brain = new ComedianBrain(deps) as unknown as {
          state: string;
          answerBuffer: string;
          sttHadFinalSegment: boolean;
          fillerFiredForAnswer: boolean;
          currentQuestion: ComedyQuestion;
          onInputTranscription(text: string, finished?: boolean): void;
        };
        brain.state = "generating";
        brain.answerBuffer = "I work in accounting.";
        brain.sttHadFinalSegment = false;
        brain.fillerFiredForAnswer = true;
        brain.currentQuestion = {
          id: "job",
          question: "What do you do for a living?",
          jokeContext: "Profession roast",
          prodLines: [],
        };

        brain.onInputTranscription("And I hate it.");
        expect(brain.state).toBe("pre_generate");
        expect(brain.fillerFiredForAnswer).toBe(false);
        expect(deps.cancelSpeech).toHaveBeenCalledOnce();

        await vi.advanceTimersByTimeAsync(90);
        await vi.advanceTimersByTimeAsync(10);
        expect(brain.fillerFiredForAnswer).toBe(true);
        expect(deps.queueSpeak).toHaveBeenCalledWith(
          expect.stringMatching(/\S/),
          expect.any(String),
          expect.any(Number),
          false,
          undefined,
          expect.objectContaining({ handoff: "filler" }),
        );
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("vision-joke startup", () => {
    it("uses only a minimal bridge while a slow vision joke remains authoritative", async () => {
      vi.useFakeTimers();
      try {
        let resolveVision!: (value: {
          relevant: true;
          jokes: Array<{ text: string; motion: "smug"; intensity: number; score: number }>;
        }) => void;
        const prefetchedGreeting = new Promise<{
          relevant: true;
          jokes: Array<{ text: string; motion: "smug"; intensity: number; score: number }>;
        }>((resolve) => { resolveVision = resolve; });
        const deps = makeDeps({ prefetchedGreeting });
        const brain = new ComedianBrain(deps) as unknown as {
          state: string;
          enterGreeting(): void;
          onTtsQueueDrained(): void;
        };

        brain.enterGreeting();
        await vi.advanceTimersByTimeAsync(50);
        expect(deps.queueSpeak).toHaveBeenCalledWith(
          VISION_GREETING_BRIDGE,
          expect.any(String),
          expect.any(Number),
          undefined,
          expect.any(Object),
        );

        brain.onTtsQueueDrained();
        expect(brain.state).toBe("greeting");

        resolveVision({
          relevant: true,
          jokes: [{ text: "That shirt surrendered before the call connected.", motion: "smug", intensity: 0.7, score: 8 }],
        });
        await Promise.resolve();
        await Promise.resolve();

        expect(deps.queueSpeak).toHaveBeenCalledWith(
          "That shirt surrendered before the call connected.",
          "smug",
          0.7,
        );
        expect(brain.state).toBe("greeting");

        brain.onTtsQueueDrained();
        expect(brain.state).toBe("ask_question");
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("yes/no response prefetch", () => {
    const binaryQuestion: ComedyQuestion = {
      id: "work_home",
      question: "Do you work from home?",
      jokeContext: "Work roast.",
      prodLines: [],
    };

    it("delivers a settled high-confidence branch before any filler beat", async () => {
      vi.useFakeTimers();
      try {
        const deps = makeDeps();
        const preparedYes: JokeResponse = {
          relevant: true,
          jokes: [{ text: "Prepared yes branch.", motion: "smug", intensity: 0.7, score: 7 }],
        };
        type Branch = {
          abort: AbortController;
          timeout: ReturnType<typeof setTimeout>;
          ready: JokeResponse | null;
          result: Promise<JokeResponse | null>;
        };
        const makeBranch = (ready: JokeResponse | null): Branch => ({
          abort: new AbortController(),
          timeout: setTimeout(() => {}, 500),
          ready,
          result: Promise.resolve(ready),
        });
        const brain = new ComedianBrain(deps) as unknown as {
          state: string;
          currentQuestion: ComedyQuestion;
          yesNoBranchPrefetch: {
            questionId: string;
            questionText: string;
            startedAt: number;
            yes: Branch;
            no: Branch;
          } | null;
          enterGenerating(answer: string): void;
          stop(): void;
        };
        brain.currentQuestion = binaryQuestion;
        brain.state = "wait_answer";
        brain.yesNoBranchPrefetch = {
          questionId: binaryQuestion.id,
          questionText: binaryQuestion.question,
          startedAt: Date.now() - 50,
          yes: makeBranch(preparedYes),
          no: makeBranch(null),
        };

        brain.enterGenerating("Yes.");
        expect(deps.queueSpeak).toHaveBeenCalledWith("Prepared yes branch.", "smug", 0.7, false);

        // The normal first acknowledgement waits 10ms in this unit config. A
        // prepared branch must never schedule it behind the selected response.
        await vi.advanceTimersByTimeAsync(20);
        expect(deps.queueSpeak).not.toHaveBeenCalledWith(
          expect.any(String),
          expect.any(String),
          expect.any(Number),
          false,
          undefined,
          expect.objectContaining({ handoff: "filler" }),
        );
        expect(deps.logTiming).toHaveBeenCalledWith(
          expect.stringContaining("yes/no branch ready=yes — bypassing filler"),
        );
        brain.stop();
      } finally {
        vi.useRealTimers();
      }
    });

    it("keeps a low-information filler when the selected branch is not ready", async () => {
      vi.useFakeTimers();
      try {
        const deps = makeDeps();
        type Branch = {
          abort: AbortController;
          timeout: ReturnType<typeof setTimeout>;
          ready: JokeResponse | null;
          result: Promise<JokeResponse | null>;
        };
        const pendingBranch = (): Branch => ({
          abort: new AbortController(),
          timeout: setTimeout(() => {}, 500),
          ready: null,
          result: new Promise<JokeResponse | null>(() => {}),
        });
        const brain = new ComedianBrain(deps) as unknown as {
          state: string;
          currentQuestion: ComedyQuestion;
          yesNoBranchPrefetch: {
            questionId: string;
            questionText: string;
            startedAt: number;
            yes: Branch;
            no: Branch;
          } | null;
          enterGenerating(answer: string): void;
          stop(): void;
        };
        brain.currentQuestion = binaryQuestion;
        brain.state = "wait_answer";
        brain.yesNoBranchPrefetch = {
          questionId: binaryQuestion.id,
          questionText: binaryQuestion.question,
          startedAt: Date.now(),
          yes: pendingBranch(),
          no: pendingBranch(),
        };

        brain.enterGenerating("Yes.");
        await vi.advanceTimersByTimeAsync(10);
        expect(deps.queueSpeak).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(String),
          expect.any(Number),
          false,
          undefined,
          expect.objectContaining({ handoff: "filler" }),
        );
        brain.stop();
        await vi.advanceTimersByTimeAsync(30);
      } finally {
        vi.useRealTimers();
      }
    });

    it("queues both inert branches and delivers only the clearly selected one", async () => {
      const branchSignals: Partial<Record<"yes" | "no", AbortSignal>> = {};
      const fetchMock = vi.fn((_: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { branchPrefetch?: "yes" | "no" };
        if (body.branchPrefetch) {
          branchSignals[body.branchPrefetch] = init?.signal ?? undefined;
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              relevant: true,
              jokes: [{
                text: body.branchPrefetch === "yes" ? "Selected yes branch." : "Wrong no branch.",
                motion: "smug",
                intensity: 0.7,
                score: 7,
              }],
            }),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ relevant: true, jokes: [] }),
        } as Response);
      });
      vi.stubGlobal("fetch", fetchMock);

      const deps = makeDeps();
      const brain = new ComedianBrain(deps) as unknown as {
        state: string;
        deliveryGeneration: number;
        currentQuestion: ComedyQuestion;
        _startYesNoBranchPrefetch(question: string): void;
        _consumeYesNoBranchPrefetch(
          answer: string,
          question: ComedyQuestion,
          conversation: string[],
          filler: string | undefined,
          generation: number,
        ): boolean;
      };
      brain.currentQuestion = binaryQuestion;
      brain.state = "ask_question";
      brain._startYesNoBranchPrefetch(binaryQuestion.question);
      await Promise.resolve();

      const branchBodies = fetchMock.mock.calls
        .map((call) => JSON.parse(String(call[1]?.body ?? "{}")) as { branchPrefetch?: string; sessionId?: string })
        .filter((body) => body.branchPrefetch);
      expect(branchBodies.map((body) => body.branchPrefetch).sort()).toEqual(["no", "yes"]);
      expect(branchBodies.every((body) => body.sessionId === undefined)).toBe(true);

      brain.state = "generating";
      brain.deliveryGeneration = 4;
      expect(
        brain._consumeYesNoBranchPrefetch("Yeah, I do.", binaryQuestion, [], undefined, 4),
      ).toBe(true);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      expect(branchSignals.no?.aborted).toBe(true);
      expect(deps.queueSpeak).toHaveBeenCalledWith("Selected yes branch.", "smug", 0.7, false);
      expect(deps.queueSpeak).not.toHaveBeenCalledWith(
        "Wrong no branch.",
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });

    it("cancels both branches and leaves ambiguous replies to the normal path", () => {
      const signals: AbortSignal[] = [];
      vi.stubGlobal("fetch", vi.fn((_: RequestInfo | URL, init?: RequestInit) => {
        if (init?.signal) signals.push(init.signal);
        return new Promise<Response>(() => {});
      }));
      const brain = new ComedianBrain(makeDeps()) as unknown as {
        currentQuestion: ComedyQuestion;
        _startYesNoBranchPrefetch(question: string): void;
        _consumeYesNoBranchPrefetch(
          answer: string,
          question: ComedyQuestion,
          conversation: string[],
          filler: string | undefined,
          generation: number,
        ): boolean;
      };
      brain.currentQuestion = binaryQuestion;
      brain._startYesNoBranchPrefetch(binaryQuestion.question);

      expect(
        brain._consumeYesNoBranchPrefetch("Maybe, it depends.", binaryQuestion, [], undefined, 1),
      ).toBe(false);
      expect(signals).toHaveLength(2);
      expect(signals.every((signal) => signal.aborted)).toBe(true);
    });
  });

  describe("established name handling", () => {
    type PrivateBrain = {
      ledger: Array<{
        type: "answer";
        text: string;
        timestamp: number;
        tags: string[];
      }>;
      currentQuestion: ComedyQuestion | null;
      _getThrowbackContext(): string[];
      _sanitizeAnswerTags(answer: string, tags: string[]): string[];
    };

    function namedBrain(): PrivateBrain {
      const brain = new ComedianBrain(makeDeps()) as unknown as PrivateBrain;
      brain.ledger = [
        {
          type: "answer",
          text: "My name is Tyler",
          timestamp: Date.now(),
          tags: ["name:Tyler"],
        },
        {
          type: "answer",
          text: "I have a wife, two kids, and a dog",
          timestamp: Date.now(),
          tags: ["relationship:married", "kids:2", "pet:dog"],
        },
      ];
      return brain;
    }

    it("always carries the established name alongside capped recent facts", () => {
      const brain = namedBrain();

      expect(brain._getThrowbackContext()).toEqual([
        "name:Tyler",
        "kids:2",
        "pet:dog",
      ]);
    });

    it("rejects a conflicting name tag on a non-name answer", () => {
      const brain = namedBrain();
      brain.currentQuestion = {
        id: "generated_work",
        question: "Do you work from home?",
        jokeContext: "Work roast.",
        prodLines: [],
      };

      expect(
        brain._sanitizeAnswerTags(
          "I'm Martin from home right now",
          ["name:Martin", "work_location:home"],
        ),
      ).toEqual(["work_location:home"]);
    });

    it("allows an explicit name correction", () => {
      const brain = namedBrain();
      brain.currentQuestion = {
        id: "generated_work",
        question: "Do you work from home?",
        jokeContext: "Work roast.",
        prodLines: [],
      };

      expect(
        brain._sanitizeAnswerTags(
          "No, my name is Martin",
          ["name:Martin"],
        ),
      ).toEqual(["name:Martin"]);
    });
  });
});
