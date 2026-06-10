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
 * - No `expectedAnswers` — Toast has no Rapid Fire variant (no speculative
 *   pre-gen by expected answer).
 * - "name" is asked first (brain pins it). Everything else shuffles.
 * - Vulgar variants stay in voice (warm-drunk profanity, not bitter-roast
 *   profanity).
 */

import type { ComedyQuestion } from "@/lib/questionBank";

export const TOAST_QUESTION_BANK: ComedyQuestion[] = [
  {
    id: "name",
    question:
      "And THAT, THAT is the kind of person they are. Just — JUST incredible. Truly. *sip* — and I have known them for — hold on. Hold ON. Oh my GOD, I'm so sorry, I am SO drunk — what's your name? What's your name again, baby?",
    vulgarQuestions: [
      "…and I LOVE that for them. I LOVE it. *sip* — okay, hold on hold on, wait — fuck, what's your name? Shit. I should know this. I'm SO sorry.",
      "And that is why we are HERE TODAY, for this absolute fucking LEGEND, who is — *sip* — oh shit, what's your name, gorgeous? Don't, don't look at me like that.",
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
    id: "embarrassing",
    question:
      "And the STORIES — oh, the STORIES we could tell — *sip* — okay no, I don't actually have one, you give me one. Tell me. The most embarrassing thing you've ever done. GO.",
    vulgarQuestions: [
      "The STORIES — the stories I could tell about this one — okay I have none, zero — *sip* — so YOU tell me: what's the most embarrassing shit you've ever done? I won't tell anyone. I'll tell everyone.",
    ],
    jokeContext:
      "She just got an embarrassing story from the user. Open with 'OH MY GOD' or 'OH NO' or 'YES, YES, I love this' — then toast around it: stack a confident drunk assumption about what this story says about their character, and celebrate the chaos. Keep it warm — she's CELEBRATING the embarrassment, not mocking it.",
    prodLines: [
      "Embarrassing thing. Hit me.",
      "Give me dirt, sweetie.",
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
