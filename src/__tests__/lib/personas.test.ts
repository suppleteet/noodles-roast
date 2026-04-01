import { describe, it, expect } from "vitest";
import { PERSONAS, PERSONA_IDS, DEFAULT_PERSONA, getPersona, type PersonaId } from "@/lib/personas";

describe("PERSONA_IDS", () => {
  it("contains all persona keys", () => {
    expect(PERSONA_IDS).toEqual(expect.arrayContaining(Object.keys(PERSONAS)));
    expect(Object.keys(PERSONAS)).toEqual(expect.arrayContaining([...PERSONA_IDS]));
  });
});

describe("DEFAULT_PERSONA", () => {
  it("is a valid persona ID", () => {
    expect(PERSONA_IDS).toContain(DEFAULT_PERSONA);
  });
});

describe("getPersona", () => {
  it("returns the correct persona for each ID", () => {
    for (const id of PERSONA_IDS) {
      const persona = getPersona(id);
      expect(persona.id).toBe(id);
      expect(persona.name).toBeTruthy();
    }
  });
});

describe("PersonaConfig shape", () => {
  for (const id of PERSONA_IDS) {
    describe(id, () => {
      const p = PERSONAS[id];

      it("has required fields", () => {
        expect(p.comedyApproach).toBeTruthy();
        expect(p.toneDescription).toBeTruthy();
        expect(p.sentenceGuidance).toBeTruthy();
        expect(p.roastTechniques.length).toBeGreaterThan(0);
        expect(p.antiPatterns.length).toBeGreaterThan(0);
        expect(p.motionPreferences.length).toBeGreaterThan(0);
      });

      it("has at least 5 greetings", () => {
        expect(p.greetings.length).toBeGreaterThanOrEqual(5);
      });

      it("has a valid energy level", () => {
        expect(["low", "medium", "high", "escalating"]).toContain(p.energy);
      });
    });
  }
});
