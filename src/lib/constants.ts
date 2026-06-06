import { getPersona, type PersonaId } from "@/lib/personas";

export const FRAME_INTERVAL_MS = 8000; // how often to grab a webcam frame for vision

export const ROAST_PAUSE_MS = 2000;    // pause between roast cycles
export const VISION_MODEL = "gemini-3.5-flash";
export const ROAST_MODEL = "gemini-3.5-flash";
export const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID ?? "EXAVITQu4vr4xnSDxMaL"; // Rachel (default, Roast)

/** Toastie uses a different ElevenLabs voice — warmer / more chaotic for the
 *  drunk-toast-at-a-wedding character. Charlotte (XB0fDUnXU5powFXDhCwa) is the
 *  default; override via the ELEVENLABS_TOASTIE_VOICE_ID env var if a better
 *  voice surfaces. */
export const TOASTIE_VOICE_ID =
  process.env.ELEVENLABS_TOASTIE_VOICE_ID ?? "XB0fDUnXU5powFXDhCwa";

/** Pick the right ElevenLabs voice for an experience type. Callers that
 *  already know the experience can use this directly; routes resolve it
 *  from the request body. Falls through to ELEVENLABS_VOICE_ID if the type
 *  is unrecognized. */
export function voiceIdForExperience(experienceType: string | undefined): string {
  return experienceType === "toastie" ? TOASTIE_VOICE_ID : ELEVENLABS_VOICE_ID;
}
export const COMPOSITOR_SIZE = 720;
export const VISION_FRAME_SIZE = 512; // 512px square — higher res for better Gemini vision detail
export const PIP_SIZE = 180;
export const SPRING_STIFFNESS = 150;
export const SPRING_DAMPING = 20;

/** Pick a random canned greeting for the given persona. */
export function getCannedGreeting(personaId: PersonaId): string {
  const greetings = getPersona(personaId).greetings;
  return greetings[Math.floor(Math.random() * greetings.length)];
}
