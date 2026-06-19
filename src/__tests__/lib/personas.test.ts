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

      it("has populated canned intro pools in both modes", () => {
        for (const mode of ["clean", "vulgar"] as const) {
          const bank = p.cannedIntros[mode];
          expect(bank.anytime.length).toBeGreaterThanOrEqual(5);
          expect(bank.early.length).toBeGreaterThanOrEqual(2);
          expect(bank.late.length).toBeGreaterThanOrEqual(2);
        }
      });

      it("every canned intro ends by asking who the user is", () => {
        for (const mode of ["clean", "vulgar"] as const) {
          const bank = p.cannedIntros[mode];
          for (const line of [...bank.anytime, ...bank.early, ...bank.late]) {
            // The opener doubles as the name question — it must END on an
            // identity ask so the first answer is the name. Kvetch uses
            // command phrasing to avoid a high rising TTS question on startup.
            // Accepts who-questions ("who is this?") and direct name asks
            // ("what's your name?") plus imperatives ("tell me your name.").
            expect(
              /\b(?:who(?:se)?\b[^?]*\?!*|what(?:'s| is)? your name\b[^?]*\?!*|what should i call you\b[^?]*\?!*|tell me (?:your|the|that damn|your damn) name\b[^.?!]*[.?!]*)$/i.test(
                line.trim(),
              ),
              `doesn't end asking who they are: "${line}"`,
            ).toBe(true);
          }
        }
      });

      it("has a valid energy level", () => {
        expect(["low", "medium", "high", "escalating"]).toContain(p.energy);
      });
    });
  }
});
