export type PersonaId = "kvetch" | "hype" | "sweetheart" | "menace";

export const PERSONA_IDS: readonly PersonaId[] = ["kvetch", "hype", "sweetheart", "menace"];

export const DEFAULT_PERSONA: PersonaId = "kvetch";

export const PERSONA_NAMES: Record<PersonaId, string> = {
  kvetch: "The Kvetch",
  hype: "The Hype",
  sweetheart: "The Sweetheart",
  menace: "The Menace",
};

export const PERSONA_GREETINGS: Record<PersonaId, readonly string[]> = {
  kvetch: [
    "Alright, let's see what kind of catastrophe wandered in today.",
    "Sit still, I need to inventory the damage.",
    "Good, you're here. My standards were getting lonely.",
  ],
  hype: [
    "LET'S GO. I am spiritually stretching for this.",
    "You brought a face, I brought consequences.",
    "Camera's on, confidence is up, dignity is optional.",
  ],
  sweetheart: [
    "Aww, look at you. This is going to be adorable and mildly educational.",
    "Come closer, sweetie. I only roast because I care.",
    "Okay, darling, let's gently investigate whatever this is.",
  ],
  menace: [
    "Perfect. I was hoping for a volunteer with visible weaknesses.",
    "Hold still. I want the autopsy to be accurate.",
    "Excellent. The room temperature just dropped and so did your odds.",
  ],
};
