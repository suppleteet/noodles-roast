import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  sendMessageStream: vi.fn(),
  openElTtsStream: vi.fn(),
  recordTtsUsage: vi.fn(),
  generateTextStream: vi.fn(),
}));

vi.mock("@/lib/chatSessionStore", () => ({
  BRIDGE_MODEL: "gemini-3.5-flash-lite",
  getBridgeSystemPrompt: () => "bridge system prompt",
  getSession: mocks.getSession,
  sendMessageStream: mocks.sendMessageStream,
}));

vi.mock("@/lib/elTtsStream", () => ({
  getElevenLabsModelId: () => "eleven_flash_v2_5",
  openElTtsStream: mocks.openElTtsStream,
}));

vi.mock("@/lib/usageTracker", () => ({
  recordTtsUsage: mocks.recordTtsUsage,
}));

vi.mock("@/lib/llmClient", () => ({
  generateTextStream: mocks.generateTextStream,
}));

import { POST } from "@/app/api/generate-bridge/route";

function request(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/generate-bridge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/generate-bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockReturnValue({
      purpose: "bridge",
      model: "gemini-3.5-flash-lite",
      experienceType: "roast",
    });
    mocks.sendMessageStream.mockImplementation(async function* () {
      yield "Tyler, ";
      yield "huh...";
    });
    mocks.generateTextStream.mockImplementation(async function* () {
      yield "An accountant. Okay...";
    });
    mocks.openElTtsStream.mockImplementation((options: {
      onAudioChunk: (chunk: string) => void;
      onDone: () => void;
    }) => ({
      sendText: vi.fn(),
      end: vi.fn(() => {
        options.onAudioChunk("pcm");
        options.onDone();
      }),
      close: vi.fn(),
    }));
  });

  it("validates the phrase before streaming typed bridge audio events", async () => {
    const response = await POST(request({
      turnId: "turn-1",
      bridgeSessionId: "bridge-session",
      question: "What is your name?",
      answer: "My name is Tyler",
    }));
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('"type":"bridge-meta"');
    expect(body).toContain('"text":"Tyler, huh..."');
    expect(body).toContain('"type":"audio"');
    expect(body).toContain('"chunk":"pcm"');
    expect(body).toContain('"type":"audio-end"');
    expect(mocks.openElTtsStream).toHaveBeenCalledOnce();
    expect(mocks.recordTtsUsage).toHaveBeenCalledWith(expect.objectContaining({
      route: "generate-bridge-stream",
      characters: 13,
    }));
  });

  it("uses the repaired name directly for the fast name-repeat beat", async () => {
    const response = await POST(request({
      turnId: "turn-name",
      bridgeSessionId: "bridge-session",
      questionId: "name",
      question: "What is your name?",
      answer: "Tyler.",
    }));
    const body = await response.text();

    expect(body).toContain('"text":"Tyler, huh..."');
    expect(body).toContain('"model":"deterministic-name-echo"');
    expect(mocks.sendMessageStream).not.toHaveBeenCalled();
    expect(mocks.generateTextStream).not.toHaveBeenCalled();
    expect(mocks.openElTtsStream).toHaveBeenCalledOnce();
  });

  it.each([
    "I'm not sure",
    "I am an accountant",
    "Uh Tyler",
    "Tyler Smith",
  ])("fails uncertain name input to the neutral cache without invoking a model: %s", async (answer) => {
    const response = await POST(request({
      turnId: "turn-uncertain-name",
      bridgeSessionId: "bridge-session",
      questionId: "name",
      question: "What is your name?",
      answer,
    }));
    const body = await response.text();

    expect(body).toContain('"error":"invalid_bridge"');
    expect(mocks.sendMessageStream).not.toHaveBeenCalled();
    expect(mocks.generateTextStream).not.toHaveBeenCalled();
    expect(mocks.openElTtsStream).not.toHaveBeenCalled();
  });

  it("fails closed before TTS when the model invents unsupported material", async () => {
    mocks.sendMessageStream.mockImplementation(async function* () {
      yield "Tyler from Seattle. Alright.";
    });
    const response = await POST(request({
      turnId: "turn-2",
      bridgeSessionId: "bridge-session",
      question: "What is your name?",
      answer: "Tyler",
    }));
    const body = await response.text();
    expect(body).toContain('"error":"invalid_bridge"');
    expect(mocks.openElTtsStream).not.toHaveBeenCalled();
  });

  it("rejects a missing or wrong-purpose session", async () => {
    mocks.getSession.mockReturnValue({ purpose: "joke" });
    const response = await POST(request({
      turnId: "turn-3",
      bridgeSessionId: "joke-session",
      question: "What is your name?",
      answer: "Tyler",
    }));
    expect(response.status).toBe(409);
    expect(mocks.sendMessageStream).not.toHaveBeenCalled();
  });

  it("uses the same pinned bridge prompt statelessly when route workers do not share memory", async () => {
    mocks.getSession.mockReturnValue(null);
    const response = await POST(request({
      turnId: "turn-4",
      bridgeSessionId: "isolated-session",
      persona: "kvetch",
      question: "What do you do for a living?",
      answer: "I am an accountant",
    }));
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain('"text":"An accountant. Okay..."');
    expect(mocks.generateTextStream).toHaveBeenCalledWith(expect.objectContaining({
      model: "gemini-3.5-flash-lite",
      reasoningProfile: "realtime-utility",
      maxOutputTokens: 24,
    }));
    expect(mocks.sendMessageStream).not.toHaveBeenCalled();
  });

  it("rejects malformed arrays and out-of-range voice settings before model or TTS work", async () => {
    const malformedFacts = await POST(request({
      turnId: "turn-5",
      bridgeSessionId: "bridge-session",
      question: "What do you do?",
      answer: "Accounting",
      knownFacts: { city: "Seattle" },
    }));
    const unsafeVoice = await POST(request({
      turnId: "turn-6",
      bridgeSessionId: "bridge-session",
      question: "What do you do?",
      answer: "Accounting",
      baseVoiceSettings: { speed: 9 },
    }));

    expect(malformedFacts.status).toBe(400);
    expect(unsafeVoice.status).toBe(400);
    expect(mocks.sendMessageStream).not.toHaveBeenCalled();
    expect(mocks.openElTtsStream).not.toHaveBeenCalled();
  });

  it("rejects non-string required fields instead of throwing", async () => {
    const response = await POST(request({
      turnId: 42,
      bridgeSessionId: "bridge-session",
      question: "What do you do?",
      answer: { text: "Accounting" },
    }));

    expect(response.status).toBe(400);
    expect(mocks.sendMessageStream).not.toHaveBeenCalled();
  });
});
