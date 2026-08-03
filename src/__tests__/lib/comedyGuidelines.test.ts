import { describe, it, expect } from "vitest";
import { GLOBAL_COMEDY_GUIDELINES, getComedyGuidelinesBlock } from "@/lib/comedyGuidelines";

describe("GLOBAL_COMEDY_GUIDELINES", () => {
  it("is a non-empty array", () => {
    expect(Array.isArray(GLOBAL_COMEDY_GUIDELINES)).toBe(true);
    expect(GLOBAL_COMEDY_GUIDELINES.length).toBeGreaterThan(0);
  });
});

describe("getComedyGuidelinesBlock", () => {
  it("includes global guidelines when called without persona", () => {
    const block = getComedyGuidelinesBlock();
    expect(block).toContain("- ");
    for (const g of GLOBAL_COMEDY_GUIDELINES) {
      expect(block).toContain(g);
    }
  });

});
