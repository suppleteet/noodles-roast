import { describe, it, expect } from "vitest";
import { sanitizeFilename } from "@/app/api/name-video/route";

describe("sanitizeFilename", () => {
  it("accepts a well-formed LLM response verbatim", () => {
    expect(sanitizeFilename("Roastie_TylerTheShittyPainter")).toBe("Roastie_TylerTheShittyPainter");
    expect(sanitizeFilename("Roastie_MoronJohnGetsRoasted")).toBe("Roastie_MoronJohnGetsRoasted");
  });

  it("strips surrounding quotes the LLM sometimes adds", () => {
    expect(sanitizeFilename('"Roastie_AlexCriesAboutCrypto"')).toBe("Roastie_AlexCriesAboutCrypto");
    expect(sanitizeFilename("'Roastie_DivorcedDadFromReno'")).toBe("Roastie_DivorcedDadFromReno");
  });

  it("re-PascalCases tokens when the LLM uses underscores or spaces", () => {
    expect(sanitizeFilename("Roastie_tyler_the_shitty_painter")).toBe("Roastie_TylerTheShittyPainter");
    expect(sanitizeFilename("Roastie Hiking Gerald Fairfax Idiot")).toBe("Roastie_HikingGeraldFairfaxIdiot");
  });

  it("caps at 4 descriptor tokens — extras are dropped", () => {
    expect(sanitizeFilename("Roastie_one_two_three_four_five_six")).toBe("Roastie_OneTwoThreeFour");
  });

  it("strips a trailing file extension if the LLM included one", () => {
    // Extensions become token-fragments; period is stripped, so the test verifies the
    // sanitizer doesn't end up with ".mp4" or similar in the filename.
    const out = sanitizeFilename("Roastie_TylerThePainter.mp4");
    expect(out).not.toContain(".");
    expect(out).toMatch(/^Roastie_/);
  });

  it("rejects empty / whitespace-only inputs", () => {
    expect(sanitizeFilename("")).toBeNull();
    expect(sanitizeFilename("   ")).toBeNull();
    expect(sanitizeFilename("Roastie_")).toBeNull();
  });

  it("rejects pathological inputs (only punctuation, etc.)", () => {
    expect(sanitizeFilename("!!!@@@###")).toBeNull();
    expect(sanitizeFilename("Roastie_!!!")).toBeNull();
  });

  it("rejects output that ends up too short after sanitization", () => {
    // After stripping non-alpha, "Roastie_a" → "a" → "A" → 1 char → too short.
    expect(sanitizeFilename("Roastie_a")).toBeNull();
  });

  it("uses only the first line if the LLM rambled into a second", () => {
    const raw = "Roastie_TylerTheShittyPainter\nThis is a great filename because...";
    expect(sanitizeFilename(raw)).toBe("Roastie_TylerTheShittyPainter");
  });

  it("preserves PascalCase boundaries from existing CamelCase input", () => {
    // No underscores/spaces — split on case boundaries.
    expect(sanitizeFilename("RoastieTylerThePainter")).toBe("Roastie_TylerThePainter");
  });
});
