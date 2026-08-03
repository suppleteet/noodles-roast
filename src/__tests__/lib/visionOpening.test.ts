import { describe, expect, it } from "vitest";
import {
  ensureVisionOpeningArrival,
  ROAST_VISION_OPENING_INTENSITY,
  ROAST_VISION_OPENING_MOTION,
} from "@/lib/visionOpening";
import { kvetch } from "@/lib/comedians/kvetch";
import { hype } from "@/lib/comedians/hype";

describe("ensureVisionOpeningArrival", () => {
  it("adds a calm arrival beat before a bare visual punchline", () => {
    expect(ensureVisionOpeningArrival("You look like a substitute teacher's ransom note.", kvetch.visionOpening)).toBe(
      "Well, hello. You look like a substitute teacher's ransom note.",
    );
  });

  it("uses the selected comedian's configured fallback rather than a shared line", () => {
    expect(ensureVisionOpeningArrival("That jacket is a felony.", hype.visionOpening)).toBe(
      "Hey there. That jacket is a felony.",
    );
  });

  it("preserves an already calm, characterful greeting", () => {
    expect(ensureVisionOpeningArrival("Wow, look at you—hello. That jacket has a parole officer.", kvetch.visionOpening)).toBe(
      "Wow, look at you—hello. That jacket has a parole officer.",
    );
  });

  it("uses a restrained motion for Roastie's first vision line", () => {
    expect(ROAST_VISION_OPENING_MOTION).toBe("deadpan");
    expect(ROAST_VISION_OPENING_INTENSITY).toBeLessThan(0.5);
  });
});
