import { describe, expect, it } from "vitest";
import { sanitizeSpokenText } from "@/lib/spokenText";

describe("sanitizeSpokenText", () => {
  it("removes stage directions without leaving malformed punctuation", () => {
    expect(sanitizeSpokenText("Right, right right right, okay, *sip*."))
      .toBe("Right, right right right, okay.");
  });

  it("preserves a single em-dash pause around a removed direction", () => {
    expect(sanitizeSpokenText("Wait — *clink* — what?"))
      .toBe("Wait — what?");
  });
});
