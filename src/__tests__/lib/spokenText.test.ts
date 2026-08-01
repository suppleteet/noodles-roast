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

  it("removes a dangling pause before punctuation", () => {
    expect(sanitizeSpokenText("Wait — *clink*. What?"))
      .toBe("Wait. What?");
  });

  it("removes an empty parenthesized direction and punctuation shell", () => {
    expect(sanitizeSpokenText("(*sigh*). Fine, let's go."))
      .toBe("Fine, let's go.");
  });

  it("returns an empty string when the input contains only a direction", () => {
    expect(sanitizeSpokenText("*long pause*."))
      .toBe("");
  });
});
