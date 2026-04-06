/**
 * Fallback roast lines per persona — used when /api/generate-joke hasn't
 * returned within the latency budget (~1200ms). These are generic enough
 * to work regardless of context but specific enough to sound intentional.
 *
 * The brain queues one of these immediately and discards/follows up with
 * the real generated joke when it arrives.
 */

import type { PersonaId } from "@/lib/personas";

export const FALLBACK_ROASTS: Record<PersonaId, string[]> = {
  kvetch: [
    "You know what, I'm looking at you and I already regret this.",
    "At my age, I've seen a lot. But this? This is something.",
    "I've been staring at you and I still can't believe it.",
    "Look, I don't even know where to start with you.",
    "You know what you remind me of? Never mind, it's too depressing.",
    "I've been doing this a long time. And you're testing me.",
    "Let me just... take a moment. This is a lot.",
    "You're really sitting there like that? Unbelievable.",
  ],
  hype: [
    "LOOK at you! I can't even process this right now!",
    "Hold on, hold on — I need a SECOND with this one!",
    "You just WALKED IN here looking like THAT?!",
    "I am not READY for what I'm seeing right now!",
    "OH we are just getting STARTED with you!",
    "The AUDACITY of you sitting there like that!",
    "I have SO MUCH to say I don't know where to BEGIN!",
    "You are a GIFT that keeps on GIVING!",
  ],
  sweetheart: [
    "Oh honey... bless your heart.",
    "You know what, you're trying. And that's... something.",
    "I'm not going to say what I'm thinking. I'm being nice.",
    "Oh sweetie, where do I even begin with you?",
    "You're really out here like that? That's... brave.",
    "I want to be nice, I really do. But you're making it hard.",
    "Look at you. Just... look at you.",
    "Oh dear. We have a lot of work to do here.",
  ],
  menace: [
    "Oh this is going to be FUN.",
    "You really walked into this one, didn't you?",
    "I've been waiting for someone like you.",
    "Oh you have NO IDEA what's coming.",
    "Just sit there. Don't move. Let me work.",
    "This is almost too easy. Almost.",
    "You look like you're about to have a very bad day.",
    "Perfect. You're exactly what I needed.",
  ],
};

/** Pick a random fallback roast for the given persona. */
export function getRandomFallback(persona: PersonaId): string {
  const lines = FALLBACK_ROASTS[persona] ?? FALLBACK_ROASTS.kvetch;
  return lines[Math.floor(Math.random() * lines.length)];
}
