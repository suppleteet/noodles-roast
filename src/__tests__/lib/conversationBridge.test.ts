import { describe, expect, it } from "vitest";
import {
  bridgeWordCount,
  deterministicNameBridge,
  validateConversationBridge,
} from "@/lib/conversationBridge";

describe("validateConversationBridge", () => {
  it("accepts a short answer-grounded acknowledgement", () => {
    expect(validateConversationBridge("Tyler, huh...", { answer: "My name is Tyler" }))
      .toBe("Tyler, huh...");
    expect(validateConversationBridge("An accountant. Okay...", { answer: "I'm an accountant" }))
      .toBe("An accountant. Okay...");
    expect(validateConversationBridge("An accountant. Oh, marvelous.", { answer: "I'm an accountant" }))
      .toBe("An accountant. Oh, marvelous.");
    expect(validateConversationBridge("An accountant. Thrilling stuff.", { answer: "I'm an accountant" }))
      .toBe("An accountant. Thrilling stuff.");
  });

  it("rejects questions, jokes, unsupported facts, and long output", () => {
    expect(validateConversationBridge("Tyler, what do you do?", { answer: "Tyler" })).toBeNull();
    expect(validateConversationBridge("An accountant, because joy was unavailable.", { answer: "accountant" })).toBeNull();
    expect(validateConversationBridge("A dentist from Seattle. Okay.", { answer: "dentist" })).toBeNull();
    expect(validateConversationBridge("You are lovely. Okay.", { answer: "I am an accountant" })).toBeNull();
    expect(validateConversationBridge("Tyler from Seattle. Alright.", {
      answer: "Tyler",
      knownFacts: ["Seattle"],
    })).toBeNull();
    expect(validateConversationBridge("One two three four five six seven eight nine ten", { answer: "one two three four five six seven eight nine ten" })).toBeNull();
  });

  it("allows content grounded in established facts", () => {
    expect(validateConversationBridge("Lives in Seattle. Alright.", {
      answer: "Tyler",
      knownFacts: ["Lives in Seattle"],
    })).toBe("Lives in Seattle. Alright.");
  });
});

describe("bridgeWordCount", () => {
  it("counts hyphenated and apostrophized speech as words", () => {
    expect(bridgeWordCount("Mm-hmm, you're an accountant.")).toBe(4);
  });
});

describe("deterministicNameBridge", () => {
  it("restores the grounded name-repeat beat without a model call", () => {
    expect(deterministicNameBridge("Tyler.")).toBe("Tyler, huh...");
    expect(deterministicNameBridge("My name is Tyler")).toBe("Tyler, huh...");
    expect(deterministicNameBridge("My name is José")).toBe("José, huh...");
  });

  it("fails closed for non-name-shaped answers", () => {
    expect(deterministicNameBridge("Is that a question?")).toBeNull();
    expect(deterministicNameBridge("I have no idea what you mean")).toBeNull();
    expect(deterministicNameBridge("I'm not sure")).toBeNull();
    expect(deterministicNameBridge("I am an accountant")).toBeNull();
    expect(deterministicNameBridge("Uh Tyler")).toBeNull();
    expect(deterministicNameBridge("Tyler Smith")).toBeNull();
  });
});
