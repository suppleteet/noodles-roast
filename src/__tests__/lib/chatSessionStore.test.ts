import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  BRIDGE_MODEL,
  compactStableContext,
  createBridgeSession,
  createSession,
  deleteSession,
  getSession,
} from "@/lib/chatSessionStore";

// Using a Claude model so createSession doesn't touch the Gemini SDK
// (it only instantiates GoogleGenAI for gemini-* models).
const DUMMY_KEY = "test-key";
const MODEL = "claude-sonnet-4-6";

describe("compactStableContext", () => {
  let sessionId: string;

  beforeEach(() => {
    sessionId = createSession(DUMMY_KEY, "kvetch", 3, "clean", MODEL);
  });

  afterEach(() => {
    deleteSession(sessionId);
  });

  it("is a no-op for unknown session ids", () => {
    const body = {
      townFlavor: "redwoods",
      setting: "home office",
      conversationSoFar: ["a", "b"],
    };
    compactStableContext("unknown-id", body);
    expect(body.townFlavor).toBe("redwoods");
    expect(body.setting).toBe("home office");
    expect(body.conversationSoFar).toEqual(["a", "b"]);
  });

  it("always drops conversationSoFar when the session exists", () => {
    const body = { conversationSoFar: ["a", "b", "c"] };
    compactStableContext(sessionId, body);
    expect(body.conversationSoFar).toBeUndefined();
  });

  it("keeps stable blocks on first call, strips them on the second identical call", () => {
    const first = { townFlavor: "redwoods & weed", setting: "home office" };
    compactStableContext(sessionId, first);
    expect(first.townFlavor).toBe("redwoods & weed");
    expect(first.setting).toBe("home office");

    const second = { townFlavor: "redwoods & weed", setting: "home office" };
    compactStableContext(sessionId, second);
    expect(second.townFlavor).toBeUndefined();
    expect(second.setting).toBeNull();
  });

  it("resends a stable block when its value changes", () => {
    compactStableContext(sessionId, { townFlavor: "redwoods" });
    const next: { townFlavor?: string } = { townFlavor: "deserts" };
    compactStableContext(sessionId, next);
    expect(next.townFlavor).toBe("deserts");

    // And remembers the new value — next identical call drops it again
    const third: { townFlavor?: string } = { townFlavor: "deserts" };
    compactStableContext(sessionId, third);
    expect(third.townFlavor).toBeUndefined();
  });

  it("dedupes ambientContext by city only", () => {
    compactStableContext(sessionId, {
      ambientContext: { city: "Woodacre", timeOfDay: "morning" },
    });
    const second: { ambientContext?: { city: string; timeOfDay: string } | null } = {
      ambientContext: { city: "Woodacre", timeOfDay: "afternoon" },
    };
    compactStableContext(sessionId, second);
    expect(second.ambientContext).toBeNull();
  });

  it("treats whitespace-only townFlavor differences as the same block", () => {
    compactStableContext(sessionId, { townFlavor: "  redwoods  " });
    const second: { townFlavor?: string } = { townFlavor: "redwoods" };
    compactStableContext(sessionId, second);
    expect(second.townFlavor).toBeUndefined();
  });
});

describe("session purposes", () => {
  it("configures joke sessions for deliberate structured comedy", () => {
    const id = createSession(DUMMY_KEY, "kvetch", 3, "clean", MODEL);
    const session = getSession(id);
    expect(session).toMatchObject({
      purpose: "joke",
      reasoningProfile: "comedy-deliberate",
      responseMimeType: "application/json",
      maxOutputTokens: 1024,
    });
    deleteSession(id);
  });

  it("pins bridge sessions to the minimal plain-text model", () => {
    // Pass a non-Gemini-shaped dummy key; constructing a Gemini Chat is local
    // and does not perform network I/O.
    const id = createBridgeSession(DUMMY_KEY, "kvetch", 3, "clean");
    const session = getSession(id);
    expect(session).toMatchObject({
      model: BRIDGE_MODEL,
      purpose: "bridge",
      reasoningProfile: "realtime-utility",
      responseMimeType: "text/plain",
      maxOutputTokens: 24,
    });
    deleteSession(id);
  });
});
