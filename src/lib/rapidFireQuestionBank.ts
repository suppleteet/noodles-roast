/**
 * Question bank for Rapid Fire flow mode.
 *
 * Different from QUESTION_BANK in src/lib/questionBank.ts:
 * - Questions take BINARY or VERY-SHORT-ANSWER responses (yes/no, single
 *   word, or A/B choice). This is what makes speculative pre-generation work
 *   — the brain can ask the LLM to produce a joke per likely answer BEFORE
 *   the user answers, and pick the right one when STT lands.
 * - Each entry (except "name") carries `expectedAnswers` — the keys the
 *   speculative pre-gen produces jokes for. Fuzzy-matched against the actual
 *   STT.
 *
 * Conversation shape:
 *   name → quick_opener → BURST → next_question → BURST → next_question → ...
 *
 * The "name" question goes first; one of the openers (single/pets/kids/
 * live_alone) is Q2; the rest of the bank shuffles into the rotation.
 *
 * Note: this uses the same ComedyQuestion type as the Original bank — the
 * brain treats both uniformly. The flow difference is in the brain's
 * delivery cadence, not in the question shape.
 */

import type { ComedyQuestion } from "@/lib/questionBank";

/**
 * Questions that work as Q2 (right after name). Lower stakes, sets tone.
 * Brain picks one of these for the Q2 slot; the rest of the bank rotates
 * in afterwards.
 */
export const RAPID_FIRE_OPENER_IDS = ["single", "pets", "kids", "live_alone"] as const;

export const RAPID_FIRE_QUESTION_BANK: ComedyQuestion[] = [
  {
    id: "name",
    question: "Who am I talking to?",
    vulgarQuestions: [
      "What's your name?",
      "Who the hell are you?",
      "Name.",
    ],
    // No expectedAnswers — names are open-ended; brain falls back to standard gen.
    jokeContext: "React to the name with a sharp one-liner — pun, association, or what the name implies.",
    prodLines: [
      "It's your name. Two seconds max.",
      "Hello? Name?",
    ],
  },
  {
    id: "single",
    question: "Single?",
    vulgarQuestions: [
      "You single? Or did someone actually agree to this?",
      "Got a partner, or are you flying solo?",
    ],
    expectedAnswers: ["yes", "no", "it's complicated"],
    jokeContext: "Single = roast the solitude. Taken = roast their partner's poor judgment. Complicated = roast the chaos.",
    prodLines: [
      "Yes or no. It's one of two answers.",
      "Single. Taken. Complicated. Pick one.",
    ],
  },
  {
    id: "pets",
    question: "Cats, dogs, or no pets?",
    vulgarQuestions: [
      "Cats, dogs, or do you even have the patience for that?",
      "What kind of fur-shedding tax do you pay — cats, dogs, or none?",
    ],
    expectedAnswers: ["cats", "dogs", "none"],
    jokeContext: "Cats = lonely-and-judgmental energy. Dogs = needy-but-loyal energy. None = too-tired-for-living-things energy.",
    prodLines: [
      "Cats. Dogs. None. Pick one.",
      "It's a three-option question.",
    ],
  },
  {
    id: "kids",
    question: "Got kids?",
    vulgarQuestions: [
      "You got kids running around, or did you dodge that bullet?",
      "Tell me you don't have kids. Tell me.",
    ],
    expectedAnswers: ["yes", "no"],
    jokeContext: "Yes = roast the parental exhaustion / poor life choices. No = roast the freedom they're squandering on this.",
    prodLines: [
      "Yes or no. Surely you'd remember.",
      "It's a binary. Pick one.",
    ],
  },
  {
    id: "live_alone",
    question: "Live alone?",
    vulgarQuestions: [
      "You live alone, or is someone putting up with you?",
      "Anyone share that disaster zone with you?",
    ],
    expectedAnswers: ["yes", "no", "with parents", "with roommates"],
    jokeContext: "Alone = roast the silence. With others = roast their tolerance. Parents = roast the regression.",
    prodLines: [
      "Yes, no, or 'with someone.' Pick one.",
      "Who's stuck living with you?",
    ],
  },
  {
    id: "coffee_tea",
    question: "Coffee or tea?",
    vulgarQuestions: [
      "Coffee or tea? Don't say neither, you weirdo.",
      "What gets you through the day — coffee, tea, or denial?",
    ],
    expectedAnswers: ["coffee", "tea", "neither"],
    jokeContext: "Coffee = caffeinated-disaster energy. Tea = trying-to-seem-sophisticated. Neither = humblebrag.",
    prodLines: [
      "It's two options. Three if you're being difficult.",
      "Coffee. Tea. Pick.",
    ],
  },
  {
    id: "morning_night",
    question: "Morning person or night owl?",
    vulgarQuestions: [
      "Morning person or insomniac?",
      "Up at dawn or up till dawn?",
    ],
    expectedAnswers: ["morning", "night"],
    jokeContext: "Morning = annoyingly chipper. Night owl = lifestyle = falling apart but romantically.",
    prodLines: [
      "Morning. Night. Easy.",
      "Pick a side.",
    ],
  },
  {
    id: "mountains_beach",
    question: "Mountains or beach?",
    vulgarQuestions: [
      "Mountains, beach, or 'just the couch'?",
      "Outdoors-disaster — mountains or beach?",
    ],
    expectedAnswers: ["mountains", "beach", "city"],
    jokeContext: "Mountains = trying-too-hard-to-seem-rugged. Beach = trying-too-hard-to-seem-relaxed. City = honest at least.",
    prodLines: [
      "Mountains. Beach. Pick.",
      "Either one. I'm roasting both.",
    ],
  },
  {
    id: "gym_couch",
    question: "Gym or couch?",
    vulgarQuestions: [
      "Gym rat or couch potato?",
      "Honest — gym or couch?",
    ],
    expectedAnswers: ["gym", "couch", "in between"],
    jokeContext: "Gym = annoyingly disciplined. Couch = honest at least. In-between = aspirational liar.",
    prodLines: [
      "Gym, couch — easy.",
      "Lying to me doesn't make it real.",
    ],
  },
  {
    id: "text_call",
    question: "Text or call?",
    vulgarQuestions: [
      "Text or call? Don't say it depends, that's not an answer.",
      "Text or actually pick up the goddamn phone?",
    ],
    expectedAnswers: ["text", "call"],
    jokeContext: "Text = avoidant. Call = chaotic-extrovert. Both reveal character.",
    prodLines: [
      "Text or call. One word.",
      "It's binary.",
    ],
  },
  {
    id: "cook_takeout",
    question: "Cook at home or takeout?",
    vulgarQuestions: [
      "Cook or just call DoorDash like the rest of us?",
      "Home-cooked or 'I don't even know where my oven is'?",
    ],
    expectedAnswers: ["cook", "takeout", "both"],
    jokeContext: "Cook = trying. Takeout = honest. Both = liar.",
    prodLines: [
      "Cook or takeout. Pick.",
      "It's one or the other.",
    ],
  },
];
