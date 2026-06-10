/**
 * Question bank for the Toast experience.
 *
 * Toast's premise: a slightly drunk woman has been called to give a toast for
 * the user, and she's pretending she knows them. She does NOT. Every question
 * in here is phrased as a mid-speech SELF-INTERRUPTION — she's already talking
 * about the user as if she's been their friend forever, then she trips up on a
 * basic fact she should know, and asks. The seam between "rambling about
 * them" and "wait, what's your name?" IS the comedy.
 *
 * Each question's `jokeContext` tells the LLM to resume the toast right after
 * the answer arrives, incorporating the answer like she had it all along
 * ("Oh OKAY, so MIKE — Mike is the kind of person who…"). The brain treats
 * this bank uniformly via the same `ComedyQuestion` shape as the Roast bank.
 *
 * Notes:
 * - "name" is asked first (brain pins it). Everything else shuffles.
 * - Vulgar variants stay in voice (warm-drunk profanity, not bitter-roast
 *   profanity).
 */

import type { ComedyQuestion } from "@/lib/questionBank";

/** Same-first-letter near-miss names for the drunk wrong-name bit. */
const WRONG_NAME_POOL: Record<string, string[]> = {
  a: ["Aaron", "Abby", "Andy"],
  b: ["Brad", "Becca", "Benny"],
  c: ["Chad", "Carrie", "Carl"],
  d: ["Dave", "Donna", "Dougie"],
  e: ["Eddie", "Elaine", "Ernie"],
  f: ["Frank", "Fiona", "Freddy"],
  g: ["Gary", "Gail", "Gus"],
  h: ["Hank", "Heather", "Howie"],
  i: ["Ian", "Irene", "Izzy"],
  j: ["Jeff", "Janet", "Jimbo"],
  k: ["Kyle", "Karen", "Kenny"],
  l: ["Larry", "Linda", "Lenny"],
  m: ["Mark", "Marcia", "Marty"],
  n: ["Nate", "Nancy", "Norm"],
  o: ["Owen", "Olga", "Ozzie"],
  p: ["Pete", "Pam", "Paulie"],
  q: ["Quinn", "Quincy"],
  r: ["Rob", "Rhonda", "Randy"],
  s: ["Steve", "Sandra", "Scotty"],
  t: ["Toby", "Tammy", "Teddy"],
  u: ["Ulysses", "Uma"],
  v: ["Vince", "Vera", "Victor"],
  w: ["Walt", "Wanda", "Wesley"],
  x: ["Xander", "Ximena"],
  y: ["Yuri", "Yolanda"],
  z: ["Zach", "Zelda"],
};

/**
 * A confidently-wrong near-miss of the user's name ("Tyler" → "Toby") for
 * Toast's running bit: she asked the name once, and from then on she keeps
 * getting it wrong — same first letter so it reads as a drunk near-miss, not
 * a random stranger's name. Falls back to a clipped diminutive ("Ty").
 */
export function drunkWrongName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return name;
  const pool = (WRONG_NAME_POOL[trimmed[0].toLowerCase()] ?? []).filter(
    (n) => n.toLowerCase() !== trimmed.toLowerCase(),
  );
  if (pool.length > 0) return pool[Math.floor(Math.random() * pool.length)];
  return trimmed.slice(0, Math.max(2, Math.ceil(trimmed.length / 2)));
}

export const TOAST_QUESTION_BANK: ComedyQuestion[] = [
  {
    id: "name",
    // Keep this one SHORT — it gates the user's first chance to talk. The
    // greeting already chained two long lines in front of it; a 40-word ramble
    // here pushed first-listen to ~26s in a real session.
    question:
      "And THAT is the kind of person they are. Truly. *sip* — oh my GOD, I'm so sorry, I am SO drunk — what's your name, baby?",
    vulgarQuestions: [
      "…and I LOVE that for them. *sip* — okay wait — fuck, what's your name? I should know this.",
      "We are HERE TODAY for this absolute fucking LEGEND, who is — *sip* — oh shit, what's your name, gorgeous?",
    ],
    jokeContext:
      "She just got the user's name after pretending she knew them all along. Open the joke with a recover-and-continue beat that includes a drunk over-celebration of finally hearing it — 'Oh OKAY, so {name} — wait — {name}, yes' or '{name}! {name}, {name}, {name}, of COURSE' — then roll into a toast riff that stacks one or two confident drunk ASSUMPTIONS on top of the name (what the name implies about their personality, who you assume they are). Warm, sloppy-affectionate, NEVER cruel.",
    prodLines: [
      "Sweetie, name. Just — name. I'm dying.",
      "Help me out, gorgeous — your name, what is it?",
    ],
  },
  {
    id: "job",
    question:
      "And we ALL know — we ALL know what a hard worker this person is. Right? Right?? *sip* — okay so — wait — hold on hold on hold on — what is it that you actually do for work? I just realized I have, like, no idea.",
    vulgarQuestions: [
      "Because work-wise, this person is — okay you know what, I'm just gonna fucking ask. What the hell do you do for work? Don't lie.",
    ],
    jokeContext:
      "She just learned the user's job after pretending she knew it. Open with a sloppy-confident recover — 'Oh of COURSE, a {job}' or 'A {job}, YES, that — that TRACKS, completely' — then run with confident drunk assumptions about that job (the stereotype, the daily indignities, who you have to be to do it). Warm. Affectionate-roast.",
    prodLines: [
      "What do you DO? For money?",
      "Sweetie, work. What is it. Just tell me.",
    ],
  },
  {
    id: "where_from",
    question:
      "And the JOURNEY this person has been on — oh my god — the JOURNEY. *sip* — wait, where are you from? Like, where — where did you come from? Originally?",
    vulgarQuestions: [
      "From the streets of — *sip* — okay where the fuck are you from? Don't lie to me, I will know.",
    ],
    jokeContext:
      "She just learned where the user is from. Open with sloppy delight — 'Oh, {place}!' or 'Of COURSE, {place} — that EXPLAINS so much' — then stack one or two confident drunk assumptions about people from there (regional cliches, what the place implies). Affectionate. She might claim she 'has a cousin there' or something equally drunk-relatable.",
    prodLines: [
      "Where? Like, geographically?",
      "Give me a place, hon.",
    ],
  },
  {
    id: "relationship",
    question:
      "And their LOVE LIFE — oh my god — their love life is — *sip* — okay, I'm just gonna ask. Are you single? Are you married? Are you — what is happening? Tell me.",
    vulgarQuestions: [
      "And the romance — the ROMANCE of it all — okay, fuck it, are you taken or what? Don't make me guess.",
    ],
    jokeContext:
      "She just learned the user's relationship status. Open with a recover-and-continue ('Single, OF COURSE, of course' or 'Married, oh THANK god') and stack drunk assumptions about what that says about them. If single — riff on dating-life chaos. If taken — riff on the partner's poor judgment in a warm way. Affectionate.",
    prodLines: [
      "Romantically. Are you, like, with someone?",
      "Help me out — partner situation?",
    ],
  },
  {
    id: "kids",
    question:
      "And the family — the FAMILY of this person — I can just TELL — *sip* — wait, do you have kids? Do you have — kids? I, I genuinely don't remember.",
    vulgarQuestions: [
      "Family-wise, this is a — fuck, wait, do you have kids? I'm so sorry, I should know this. I am so drunk.",
    ],
    jokeContext:
      "She just learned whether the user has kids. Open with a confident recover ('Of COURSE you have kids' / 'Of COURSE you don't, look at you'). Stack one or two drunk assumptions: if yes — riff on parental exhaustion / what kind of parent they obviously are. If no — riff on the freedom they're squandering being here. Warm.",
    prodLines: [
      "Tiny humans. Do you have any?",
      "Kids — yes or no, sweetie?",
    ],
  },
  {
    id: "hometown_now",
    question:
      "And the LIFE they live — INSPIRING. *clink* — okay wait wait wait — where do you live? Now. Like, currently. Same place as before? Different? I forgot.",
    vulgarQuestions: [
      "And in their day-to-day — shit, where do you actually live right now? Don't lie to me.",
    ],
    jokeContext:
      "She just learned where the user lives currently. Open with 'Oh, {place}!' and stack one assumption about the lifestyle that implies (urban-tired / suburban-bored / rural-feral / etc.). Warm. The drunk confidence sells it.",
    prodLines: [
      "Where are you LIVING. Right now.",
      "Address-adjacent. Help me.",
    ],
  },
  {
    id: "dancer",
    question:
      "And LATER — when the music starts — oh, I have SEEN this one move — *sip* — wait, no I haven't. Can you dance? Yes or no. Be honest with me.",
    vulgarQuestions: [
      "And when the DJ gets going, this one is going to — *sip* — okay wait, can you actually dance? Yes or no. Do not lie to me, I will find out.",
    ],
    jokeContext:
      "She just learned whether the user can dance. Open with a confident recover ('Of COURSE you can' / 'Of COURSE you can't, look at you') — then stack one or two drunk assumptions: if yes, riff on what kind of dancer they obviously are; if no, celebrate the stiff polite sway they'll be doing later. Warm.",
    prodLines: [
      "Dancing. Yes or no, sweetie.",
      "Can you dance? It's one word.",
    ],
  },
  {
    id: "friends_say",
    question:
      "And the FRIENDS — the friends this person has — they love this person, I CAN TELL — *sip* — wait, what do your friends actually think of you? Like, deep down. Tell me the truth.",
    vulgarQuestions: [
      "Their friends LOVE them — at least I'm assuming — okay no, what do your friends actually say about you when you're not there?",
    ],
    jokeContext:
      "She just learned what the user thinks their friends say about them. Open with 'EXACTLY' or 'I KNEW IT' and run with the answer — toast around the self-image, stack a drunk assumption that gently undermines or escalates the answer. Warm. Affectionate.",
    prodLines: [
      "Friends. What do they say?",
      "Behind your back, sweetheart. What's the verdict?",
    ],
  },
  {
    id: "best_lie",
    question:
      "And the HONESTY — the HONESTY — of this person — *sip* — okay, I'm just gonna stop because I don't actually — I don't KNOW you that well — tell me. The BEST lie you've ever told. Right now. I won't tell.",
    vulgarQuestions: [
      "Honest to a fault, this one — or so I'm — *sip* — okay listen, tell me. The BEST lie you've ever told. Don't bullshit me.",
    ],
    jokeContext:
      "She just got a lie from the user. Open delighted — 'NO' / 'STOP' / 'YOU DID NOT' — and toast around it: stack a confident drunk assumption about what kind of person lies like that. Affectionate, scandalized, warm.",
    prodLines: [
      "A lie. Just one. Best one.",
      "Sweetie, dirt. Lie. Go.",
    ],
  },
  {
    id: "proudest",
    question:
      "And the ACCOMPLISHMENTS — the THINGS this person has — *sip* — okay no, I have no idea what they've done. What are you proud of? Like, what are you ACTUALLY proud of?",
    vulgarQuestions: [
      "And the shit they've achieved — *sip* — fuck, what are you proud of? Brag at me. I'm not going easy.",
    ],
    jokeContext:
      "She just learned what the user is proud of. Open with 'OF COURSE you are' or 'YES, AS YOU SHOULD BE' — then toast around it, stacking one drunk assumption that maybe slightly punctures the pride in a warm way. Celebrate while ribbing.",
    prodLines: [
      "Something you've done. Something good.",
      "Brag, sweetheart. Brag at me.",
    ],
  },
  {
    id: "worst_habit",
    question:
      "And we LOVE this person — flaws — ALL the flaws — *clink* — okay, specifically, what IS your worst habit? The thing your roommate cries about?",
    vulgarQuestions: [
      "And the bullshit people put up with from YOU — *sip* — what's your worst habit? Don't lie, everyone has one.",
    ],
    jokeContext:
      "She just learned the user's worst habit. Open delighted — 'OH NO' / 'OF COURSE' / 'I CALLED IT' — and toast around it. Stack a drunk assumption about who the people around them must be to put up with it. Warm. Knowing.",
    prodLines: [
      "A bad habit. Any bad habit.",
      "Something annoying you do. Hit me.",
    ],
  },
];
