/**
 * Question bank for the Toastie experience.
 *
 * Toastie's premise: a slightly drunk woman has been called to give a toast for
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
 * - No `expectedAnswers` — Toastie has no Rapid Fire variant (no speculative
 *   pre-gen by expected answer).
 * - "name" is asked first (brain pins it). Everything else shuffles.
 * - Vulgar variants stay in voice (warm-drunk profanity, not bitter-roast
 *   profanity).
 */

import type { ComedyQuestion } from "@/lib/questionBank";

export const TOASTIE_QUESTION_BANK: ComedyQuestion[] = [
  {
    id: "name",
    question:
      "And THAT is the kind of person they are. Just — incredible. Wait wait wait. Oh god, I'm so sorry — what was your name again?",
    vulgarQuestions: [
      "…and I love that for them, truly. Hold on. Hold on. Fuck, wait — what's your name? I should know this. I should TOTALLY know this.",
      "And that's why we're all here today, for this absolute LEGEND, who is — shit, what's your name again, gorgeous? Don't look at me like that.",
    ],
    jokeContext:
      "She just got the user's name after pretending she knew them all along. Open the joke with a recover-and-continue beat — 'Oh OKAY, so {name} — ' or 'Right, RIGHT, of course, {name}, ' — then roll into a toast riff that stacks one or two confident drunk ASSUMPTIONS on top of the name (what the name implies about their personality, who you assume they are). Keep it warm and affectionate, not cruel.",
    prodLines: [
      "Sweetie, your name? I'm dying out here.",
      "Help me out, gorgeous — name?",
    ],
  },
  {
    id: "job",
    question:
      "And we ALL know what a hard worker they are. Right? Right?? Okay so — actually, hold on — what is it that you do for work? I just realized I have no idea.",
    vulgarQuestions: [
      "Because work-wise, this person is — okay you know what, I'm gonna stop bullshitting. What the hell do you do for a living?",
    ],
    jokeContext:
      "She just learned the user's job after pretending she knew it. Open with 'Oh of COURSE, a {job}' or 'A {job}, YES, that tracks completely' — then run with confident drunk assumptions about that job (the stereotype, the daily indignities, who you have to be to do it). Warm. Affectionate-roast.",
    prodLines: [
      "What do you DO? Like for money?",
      "Sweetie, work. What is it?",
    ],
  },
  {
    id: "where_from",
    question:
      "And the JOURNEY this person has been on — incredible. Truly. Wait, where are you actually from? Like, originally?",
    vulgarQuestions: [
      "From the streets of — okay, where the fuck are you actually from? Don't lie to me.",
    ],
    jokeContext:
      "She just learned where the user is from. Open with 'Oh, {place}!' or 'Of COURSE, {place} — that explains SO MUCH' — then stack one or two confident assumptions about people from there (regional cliches, what the place implies). Affectionate. Maybe she 'has a cousin there' or something equally drunk-relatable.",
    prodLines: [
      "Where? Like, geographically?",
      "Give me a place, hon.",
    ],
  },
  {
    id: "relationship",
    question:
      "And their LOVE LIFE is — okay you know what, I'm not gonna pretend, are you single? Married? I genuinely have no idea.",
    vulgarQuestions: [
      "And the romance of it all — fuck, are you taken or what? Don't make me guess.",
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
      "And the family — they're a FAMILY person, I can just TELL — wait, do you have kids? I genuinely don't remember.",
    vulgarQuestions: [
      "Family-wise, this is a — fuck, do you have kids? I'm so sorry, I should know this.",
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
      "And living the LIFE they live — totally inspiring — okay wait, where do you actually live NOW? Like, currently? Same place? Different place?",
    vulgarQuestions: [
      "And in their day-to-day — shit, where do you live right now? Don't lie.",
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
      "And the STORIES we could tell about this person — OH the stories — okay no actually, I don't have one, give me one. What's the most embarrassing thing you've ever done?",
    vulgarQuestions: [
      "The shit we've been through together — except we haven't, so — fuck it, tell me. What's the worst thing you've ever done? I won't tell anyone. I'll tell everyone.",
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
      "And the FRIENDS — oh, the friends this person has — wait, what do your friends actually think of you? Like, deep down. Be honest.",
    vulgarQuestions: [
      "Their friends LOVE them — at least I assume — what do your friends actually say about you when you're not there?",
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
      "And the HONESTY of this person — okay, I'm gonna stop because I don't actually know — what's the best lie you've ever told? I won't tell.",
    vulgarQuestions: [
      "Honest to a fault, this one — or so I'm told — so tell me, what's the BEST lie you've ever told? Don't bullshit me.",
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
      "And the ACCOMPLISHMENTS — okay actually I have no idea what they've done. What are you, like, ACTUALLY proud of?",
    vulgarQuestions: [
      "And the shit they've achieved — fuck, what are you proud of? I'm not going easy on you.",
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
      "And we LOVE this person — flaws and all — okay specifically, what IS your worst habit? Like, what's the thing your roommate complains about?",
    vulgarQuestions: [
      "And the bullshit they put up with from YOU — what's your worst habit? Don't say you don't have one, everyone has one.",
    ],
    jokeContext:
      "She just learned the user's worst habit. Open delighted — 'OH NO' / 'OF COURSE' / 'I CALLED IT' — and toast around it. Stack a drunk assumption about who the people around them must be to put up with it. Warm. Knowing.",
    prodLines: [
      "A bad habit. Any bad habit.",
      "Something annoying you do. Hit me.",
    ],
  },
];
