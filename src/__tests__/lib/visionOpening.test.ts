import { describe, expect, it } from "vitest";
import { ensureVisionOpeningArrival } from "@/lib/visionOpening";

describe("ensureVisionOpeningArrival", () => {
  it("adds a calm arrival beat before a bare visual punchline", () => {
    expect(ensureVisionOpeningArrival("You look like a substitute teacher's ransom note.")).toBe(
      "Well, hello. You look like a substitute teacher's ransom note.",
    );
  });

  it("preserves an already calm, characterful greeting", () => {
    expect(ensureVisionOpeningArrival("Wow, look at you—hello. That jacket has a parole officer.")).toBe(
      "Wow, look at you—hello. That jacket has a parole officer.",
    );
  });
});
