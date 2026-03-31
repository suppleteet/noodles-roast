import { describe, it, expect } from "vitest";
import { diffObservations } from "@/lib/visionDiff";

describe("diffObservations", () => {
  it("returns no changes and not interesting when current is empty", () => {
    const result = diffObservations(["big smile", "curly hair"], []);
    expect(result.isInteresting).toBe(false);
    expect(result.changes).toHaveLength(0);
  });

  it("all observations are new when prev is empty", () => {
    const result = diffObservations([], ["curly hair", "wearing glasses"]);
    expect(result.changes).toEqual(["curly hair", "wearing glasses"]);
  });

  it("filters out observations already seen in prev (exact match)", () => {
    const result = diffObservations(["curly hair", "full beard"], ["curly hair", "now smiling"]);
    expect(result.changes).toEqual(["now smiling"]);
  });

  it("filters out observations that are substrings of prev (fuzzy match)", () => {
    // "curly" is a substring of "dark curly hair"
    const result = diffObservations(["dark curly hair"], ["curly"]);
    expect(result.changes).toHaveLength(0);
  });

  it("filters out observations where prev is a substring of current (fuzzy match)", () => {
    const result = diffObservations(["smiling"], ["broadly smiling"]);
    expect(result.changes).toHaveLength(0);
  });

  it("isInteresting = true when a new observation contains a high-interest keyword", () => {
    const result = diffObservations([], ["laughing heartily"]);
    expect(result.isInteresting).toBe(true);
  });

  it("isInteresting = true for 'pet' keyword", () => {
    const result = diffObservations([], ["a pet dog appeared"]);
    expect(result.isInteresting).toBe(true);
  });

  it("isInteresting = true for 'glasses' keyword", () => {
    const result = diffObservations([], ["now wearing glasses"]);
    expect(result.isInteresting).toBe(true);
  });

  it("isInteresting = true when 4+ new observations appear (threshold)", () => {
    const result = diffObservations([], ["obs1", "obs2", "obs3", "obs4"]);
    expect(result.isInteresting).toBe(true);
    expect(result.changes).toHaveLength(4);
  });

  it("isInteresting = false when only 3 new non-keyword observations", () => {
    const result = diffObservations([], ["messy hair", "grey t-shirt", "looking sideways"]);
    expect(result.isInteresting).toBe(false);
  });

  it("isInteresting = false when all current observations are already known", () => {
    const prev = ["smiling", "dark hair", "bearded"];
    const current = ["smiling", "dark hair", "bearded"];
    const result = diffObservations(prev, current);
    expect(result.isInteresting).toBe(false);
    expect(result.changes).toHaveLength(0);
  });

  it("high-interest keyword is case-insensitive", () => {
    const result = diffObservations([], ["LAUGHING loudly"]);
    expect(result.isInteresting).toBe(true);
  });

  it("isInteresting = false when new observation has no keyword and count < 4", () => {
    const result = diffObservations(["curly hair"], ["looking down"]);
    expect(result.isInteresting).toBe(false);
    expect(result.changes).toEqual(["looking down"]);
  });
});
