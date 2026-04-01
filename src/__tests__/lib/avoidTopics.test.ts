import { describe, it, expect } from "vitest";
import { GLOBAL_AVOID_TOPICS, getAvoidTopicsBlock } from "@/lib/avoidTopics";

describe("GLOBAL_AVOID_TOPICS", () => {
  it("is a non-empty array of strings", () => {
    expect(GLOBAL_AVOID_TOPICS.length).toBeGreaterThan(0);
    for (const topic of GLOBAL_AVOID_TOPICS) {
      expect(typeof topic).toBe("string");
    }
  });

  it("includes technology prohibition", () => {
    expect(GLOBAL_AVOID_TOPICS.some((t) => t.toLowerCase().includes("technology"))).toBe(true);
  });

  it("includes background objects prohibition", () => {
    expect(GLOBAL_AVOID_TOPICS.some((t) => t.toLowerCase().includes("background objects"))).toBe(true);
  });
});

describe("getAvoidTopicsBlock", () => {
  it("returns a bullet list of global topics", () => {
    const block = getAvoidTopicsBlock();
    expect(block).toContain("- ");
    const lines = block.split("\n");
    expect(lines.length).toBe(GLOBAL_AVOID_TOPICS.length);
  });

  it("merges persona-specific topics", () => {
    const block = getAvoidTopicsBlock(["No puns"]);
    const lines = block.split("\n");
    expect(lines.length).toBe(GLOBAL_AVOID_TOPICS.length + 1);
    expect(block).toContain("No puns");
  });

  it("adds clean mode restrictions", () => {
    const block = getAvoidTopicsBlock(undefined, "clean");
    expect(block).toContain("profanity");
    expect(block).toContain("Sexual");
  });

  it("does not add clean restrictions in vulgar mode", () => {
    const block = getAvoidTopicsBlock(undefined, "vulgar");
    expect(block).not.toContain("profanity");
  });
});
