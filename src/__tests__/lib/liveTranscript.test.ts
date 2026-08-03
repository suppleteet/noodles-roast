import { describe, expect, it } from "vitest";
import { mergeLiveTranscript } from "@/lib/liveTranscript";

describe("mergeLiveTranscript", () => {
  it("assembles Gemini syllable and word deltas", () => {
    let transcript = "";
    for (const chunk of [" Ye", "s", ",", " I", " have", " two", " kids."]) {
      transcript = mergeLiveTranscript(transcript, chunk, false);
    }
    expect(transcript.trim()).toBe("Yes, I have two kids.");
  });

  it("appends a short final delta instead of discarding earlier chunks", () => {
    const partial = " Uh, my name is Stephen";
    expect(mergeLiveTranscript(partial, " Charmer.", true).trim()).toBe(
      "Uh, my name is Stephen Charmer.",
    );
  });

  it("accepts a cumulative corrected final transcript", () => {
    expect(mergeLiveTranscript("I am 4 2", "I am 42.", true)).toBe("I am 42.");
  });
});
