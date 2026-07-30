import { describe, expect, it } from "vitest";
import {
  chooseTranscriptRepair,
  isTranscriptRepairResult,
  shouldAttemptTranscriptRepair,
} from "@/lib/transcriptRepair";

describe("chooseTranscriptRepair", () => {
  it("accepts a small high-confidence phonetic repair", () => {
    expect(
      chooseTranscriptRepair("I'm a dennis", "job", [], {
        correctedText: "I'm a dentist",
        changed: true,
        confidence: 0.96,
        reason: "Dentist fits the job question and is phonetically close.",
      }),
    ).toMatchObject({
      text: "I'm a dentist",
      changed: true,
      confidence: 0.96,
    });
  });

  it("rejects a broad paraphrase even when the model is confident", () => {
    expect(
      chooseTranscriptRepair("I work in software sales", "job", [], {
        correctedText: "I'm an enterprise account executive",
        changed: true,
        confidence: 0.99,
      }),
    ).toMatchObject({
      text: "I work in software sales",
      changed: false,
    });
  });

  it("rejects low-confidence changes", () => {
    expect(
      chooseTranscriptRepair("Woodwicker", "where_from", [], {
        correctedText: "Woodacre",
        changed: true,
        confidence: 0.72,
      }),
    ).toMatchObject({ text: "Woodwicker", changed: false });
  });

  it("never changes negation or digit- or word-form numbers", () => {
    expect(
      chooseTranscriptRepair("I'm not married", "single", [], {
        correctedText: "I'm married",
        changed: true,
        confidence: 0.99,
      }).changed,
    ).toBe(false);
    expect(
      chooseTranscriptRepair("I'm 42", "age", [], {
        correctedText: "I'm 32",
        changed: true,
        confidence: 0.99,
      }).changed,
    ).toBe(false);
    expect(
      chooseTranscriptRepair("I'm forty-two", "age", [], {
        correctedText: "I'm thirty-two",
        changed: true,
        confidence: 0.99,
      }).changed,
    ).toBe(false);
  });

  it("rejects more than one token edit even in a longer answer", () => {
    expect(
      chooseTranscriptRepair("I repair old wooden boats on weekends", "job", [], {
        correctedText: "I restore vintage wooden boats on weekends",
        changed: true,
        confidence: 0.99,
      }).changed,
    ).toBe(false);
  });

  it("does not guess a new name but can restore an established one", () => {
    expect(
      chooseTranscriptRepair("Alex", "name", [], {
        correctedText: "Aleks",
        changed: true,
        confidence: 0.99,
      }).changed,
    ).toBe(false);
    expect(
      chooseTranscriptRepair("Alex", "name", ["name:Aleks"], {
        correctedText: "Aleks",
        changed: true,
        confidence: 0.99,
      }),
    ).toMatchObject({ text: "Aleks", changed: true });
  });
});

describe("shouldAttemptTranscriptRepair", () => {
  it("skips deterministic answers and unknown first-time names", () => {
    expect(shouldAttemptTranscriptRepair("42", "age", [])).toBe(false);
    expect(shouldAttemptTranscriptRepair("forty-two", "age", [])).toBe(false);
    expect(shouldAttemptTranscriptRepair("No", "single", [])).toBe(false);
    expect(shouldAttemptTranscriptRepair("Alex", "name", [])).toBe(false);
  });

  it("checks semantic answers and previously established names", () => {
    expect(shouldAttemptTranscriptRepair("I'm a dennis", "job", [])).toBe(true);
    expect(
      shouldAttemptTranscriptRepair("Alex", "name", ["name:Aleks"]),
    ).toBe(true);
  });
});

describe("isTranscriptRepairResult", () => {
  it("accepts the bounded response shape and rejects malformed provider data", () => {
    expect(
      isTranscriptRepairResult({
        text: "I'm a dentist",
        changed: true,
        confidence: 0.95,
      }),
    ).toBe(true);
    expect(
      isTranscriptRepairResult({
        text: null,
        changed: "yes",
        confidence: 2,
      }),
    ).toBe(false);
  });
});
