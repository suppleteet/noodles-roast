import { describe, it, expect } from "vitest";
import { matchExpectedAnswer } from "@/lib/expectedAnswerMatch";

const YES_NO = ["yes", "no"];
const YES_NO_COMPLICATED = ["yes", "no", "it's complicated"];
const PETS = ["cats", "dogs", "none"];
const LIVE_ALONE = ["yes", "no", "with parents", "with roommates"];
const AB = ["mountains", "beach"];

describe("matchExpectedAnswer", () => {
  describe("yes/no affinity", () => {
    it("matches 'yes' exactly", () => {
      expect(matchExpectedAnswer("yes", YES_NO)).toBe("yes");
    });
    it("matches 'Yes.' with punctuation+case", () => {
      expect(matchExpectedAnswer("Yes.", YES_NO)).toBe("yes");
    });
    it("matches 'yeah' to yes", () => {
      expect(matchExpectedAnswer("yeah", YES_NO)).toBe("yes");
    });
    it("matches 'yep' to yes", () => {
      expect(matchExpectedAnswer("yep", YES_NO)).toBe("yes");
    });
    it("matches 'uh huh' to yes", () => {
      expect(matchExpectedAnswer("uh huh", YES_NO)).toBe("yes");
    });
    it("matches 'yeah I am' to yes (prefix expansion)", () => {
      expect(matchExpectedAnswer("yeah I am", YES_NO)).toBe("yes");
    });
    it("matches 'no' exactly", () => {
      expect(matchExpectedAnswer("no", YES_NO)).toBe("no");
    });
    it("matches 'nope' to no", () => {
      expect(matchExpectedAnswer("nope", YES_NO)).toBe("no");
    });
    it("matches 'nah' to no", () => {
      expect(matchExpectedAnswer("nah", YES_NO)).toBe("no");
    });
    it("matches 'not really' to no", () => {
      expect(matchExpectedAnswer("not really", YES_NO)).toBe("no");
    });
    it("matches 'no, I don't' to no (prefix expansion)", () => {
      expect(matchExpectedAnswer("no, I don't", YES_NO)).toBe("no");
    });
  });

  describe("category words", () => {
    it("matches 'cats' to cats", () => {
      expect(matchExpectedAnswer("cats", PETS)).toBe("cats");
    });
    it("matches 'I have cats' to cats (key as substring)", () => {
      expect(matchExpectedAnswer("I have cats", PETS)).toBe("cats");
    });
    it("matches 'a dog' to dogs (word overlap won't, falls through)", () => {
      // "a dog" doesn't contain "dogs" as substring and word overlap of "dog"
      // vs "dogs" is zero (no stemming). This is an accepted limitation — the
      // brain falls back to fresh gen.
      expect(matchExpectedAnswer("a dog", PETS)).toBeNull();
    });
    it("matches 'dogs' exactly", () => {
      expect(matchExpectedAnswer("dogs", PETS)).toBe("dogs");
    });
    it("matches 'no pets' to none (none has zero overlap, falls through)", () => {
      // Accepted limitation — "no pets" doesn't share words with "none". The
      // unit test documents the gap; bank could add "no pets" as an explicit
      // expected answer if real-world STT shows this pattern.
      expect(matchExpectedAnswer("no pets", PETS)).toBeNull();
    });
  });

  describe("multi-word expected keys", () => {
    it("matches 'it's complicated' exactly", () => {
      expect(matchExpectedAnswer("it's complicated", YES_NO_COMPLICATED)).toBe("it's complicated");
    });
    it("matches 'complicated' to 'it's complicated' (STT in key)", () => {
      expect(matchExpectedAnswer("complicated", YES_NO_COMPLICATED)).toBe("it's complicated");
    });
    it("matches 'with my parents' to 'with parents' (word overlap)", () => {
      expect(matchExpectedAnswer("with my parents", LIVE_ALONE)).toBe("with parents");
    });
    it("matches 'with roommates' exactly", () => {
      expect(matchExpectedAnswer("with roommates", LIVE_ALONE)).toBe("with roommates");
    });
  });

  describe("A/B choice", () => {
    it("matches 'mountains' to mountains", () => {
      expect(matchExpectedAnswer("mountains", AB)).toBe("mountains");
    });
    it("matches 'the beach' to beach (key in STT)", () => {
      expect(matchExpectedAnswer("the beach", AB)).toBe("beach");
    });
    it("matches 'definitely beach' to beach", () => {
      expect(matchExpectedAnswer("definitely beach", AB)).toBe("beach");
    });
  });

  describe("no match cases", () => {
    it("returns null for empty STT", () => {
      expect(matchExpectedAnswer("", YES_NO)).toBeNull();
    });
    it("returns null for empty expected list", () => {
      expect(matchExpectedAnswer("yes", [])).toBeNull();
    });
    it("returns null for unrelated answer", () => {
      expect(matchExpectedAnswer("the moon is purple", PETS)).toBeNull();
    });
    it("returns null when 'yes' affinity hits but no 'yes' key exists", () => {
      expect(matchExpectedAnswer("yeah", PETS)).toBeNull();
    });
  });

  describe("ambiguity (highest-confidence wins)", () => {
    it("'yes' beats other partial overlaps", () => {
      // STT "yes I love cats" — yes/no affinity should fire first; cats word
      // overlap is irrelevant once a high-confidence affinity match is found.
      expect(matchExpectedAnswer("yes I love cats", ["yes", "cats"])).toBe("yes");
    });
    it("falls through to scoring when no yes/no affinity", () => {
      expect(matchExpectedAnswer("cats are great", ["cats", "dogs"])).toBe("cats");
    });
  });
});
