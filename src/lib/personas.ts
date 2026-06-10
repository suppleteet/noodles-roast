/**
 * Persona registry — assembly only, no character content.
 *
 * EACH COMEDIAN'S ACTUAL CHARACTER LIVES IN ITS OWN FILE under
 * src/lib/comedians/ — edit those files to change how a comedian talks,
 * jokes, and moves:
 *   src/lib/comedians/kvetch.ts
 *   src/lib/comedians/hype.ts
 *   src/lib/comedians/sweetheart.ts
 *   src/lib/comedians/menace.ts
 * (The Toast character is separate — src/lib/toastPrompts.ts.)
 *
 * View any comedian's fully-assembled system prompt at
 * /api/debug-prompt?persona=<id>.
 *
 * Do NOT import this from client code — it pulls in all the prompt text.
 * Client code imports from @/lib/personaMetadata instead.
 */
import type { PersonaId } from "@/lib/personaMetadata";
import type { PersonaConfig } from "@/lib/comedians/types";
import { kvetch } from "@/lib/comedians/kvetch";
import { hype } from "@/lib/comedians/hype";
import { sweetheart } from "@/lib/comedians/sweetheart";
import { menace } from "@/lib/comedians/menace";

export { PERSONA_IDS, DEFAULT_PERSONA, type PersonaId } from "@/lib/personaMetadata";
export type { PersonaConfig } from "@/lib/comedians/types";

export const PERSONAS: Record<PersonaId, PersonaConfig> = {
  kvetch,
  hype,
  sweetheart,
  menace,
};

export function getPersona(id: PersonaId): PersonaConfig {
  return PERSONAS[id];
}
