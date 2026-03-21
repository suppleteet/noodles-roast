import { describe, it, expect } from "vitest";
import { inferMotionFromTranscript } from "@/lib/motionInference";

describe("inferMotionFromTranscript", () => {
  it("returns laugh for laughter sounds", () => {
    expect(inferMotionFromTranscript("hahaha", 0.5)[0]).toBe("laugh");
    expect(inferMotionFromTranscript("bwahaha that was good", 0.3)[0]).toBe("laugh");
  });

  it("returns shocked for surprise words", () => {
    expect(inferMotionFromTranscript("oh my god what is that", 0.4)[0]).toBe("shocked");
    expect(inferMotionFromTranscript("whoa!!", 0.5)[0]).toBe("shocked");
    expect(inferMotionFromTranscript("no way", 0.3)[0]).toBe("shocked");
  });

  it("returns conspiratorial for low-energy secret phrases", () => {
    const [motion] = inferMotionFromTranscript("between you and me", 0.1);
    expect(motion).toBe("conspiratorial");
  });

  it("does not trigger conspiratorial at high energy", () => {
    const [motion] = inferMotionFromTranscript("between you and me", 0.5);
    expect(motion).not.toBe("conspiratorial");
  });

  it("returns smug for sarcasm phrases", () => {
    expect(inferMotionFromTranscript("oh really now", 0.3)[0]).toBe("smug");
    expect(inferMotionFromTranscript("oh sure you did", 0.4)[0]).toBe("smug");
    expect(inferMotionFromTranscript("obviously", 0.3)[0]).toBe("smug");
  });

  it("does not trigger smug on common words alone", () => {
    // "right" and "sure" alone should NOT be smug (they were tightened)
    const [motion1] = inferMotionFromTranscript("right", 0.3);
    expect(motion1).not.toBe("smug");
    const [motion2] = inferMotionFromTranscript("sure", 0.3);
    expect(motion2).not.toBe("smug");
  });

  it("returns thinking for pondering phrases", () => {
    expect(inferMotionFromTranscript("hmm let me think", 0.2)[0]).toBe("thinking");
    expect(inferMotionFromTranscript("well interesting", 0.2)[0]).toBe("thinking");
  });

  it("returns emphasis for high energy", () => {
    const [motion] = inferMotionFromTranscript("you look great today!", 0.7);
    // High energy + exclamation -> emphasis or energetic
    expect(["emphasis", "shocked"]).toContain(motion);
  });

  it("returns energetic for moderate-high energy", () => {
    const [motion] = inferMotionFromTranscript("and then I said", 0.45);
    expect(motion).toBe("energetic");
  });

  it("returns idle with low energy and neutral text", () => {
    const [motion, intensity] = inferMotionFromTranscript("hello there", 0.1);
    expect(motion).toBe("idle");
    expect(intensity).toBeGreaterThan(0);
    expect(intensity).toBeLessThan(1);
  });

  it("intensity scales with audio energy", () => {
    const [, lowIntensity] = inferMotionFromTranscript("hello", 0.0);
    const [, highIntensity] = inferMotionFromTranscript("hello", 0.9);
    expect(highIntensity).toBeGreaterThan(lowIntensity);
  });
});
