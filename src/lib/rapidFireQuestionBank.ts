/**
 * Question bank for Rapid Fire flow mode.
 *
 * VOICE: blunt, simple, like a grumpy old person firing off quick questions —
 * NOT clever or wordy. "And how old are you?" / "You got any kids?" — plain.
 * Keep them short; the burst joke does the comedy, the questions just gather facts.
 *
 * Flow: an instant canned opener (see RAPID_FIRE_OPENERS in scriptLines.ts) both
 * greets AND asks the name, so the first answer is the name. After that the brain
 * collects a couple answers behind quick acks, then drops a combined joke burst —
 * see comedianBrain.ts. The "name" entry below still exists because the opener is
 * tracked as the name question.
 *
 * `excludes`: if a question is asked, the listed ids are dropped from the session —
 * keeps the puppet from asking "you single?" right after they mention a spouse.
 *
 * Same ComedyQuestion type as the Original bank.
 */

import type { ComedyQuestion } from "@/lib/questionBank";

export const RAPID_FIRE_QUESTION_BANK: ComedyQuestion[] = [
  {
    id: "name",
    question: "Who am I talking to?",
    vulgarQuestions: [
      "Who the hell are you?",
      "What's your name?",
      "Who's this, then?",
    ],
    jokeContext: "React to the name — pun, association, or what the name implies.",
    prodLines: [
      "It's your name. Come on.",
      "Hello? Name?",
    ],
  },
  {
    id: "age",
    question: "And how old are you?",
    vulgarQuestions: [
      "How old are you, anyway?",
      "What are you, age-wise?",
    ],
    jokeContext: "Roast the age — too old to be doing this, too young to know better, whatever fits.",
    prodLines: [
      "A number. Any number.",
      "How old? Don't lie, I can tell.",
    ],
  },
  {
    id: "job",
    question: "What do you do for work?",
    vulgarQuestions: [
      "What the hell do you do for money?",
      "What's the job, then?",
    ],
    jokeContext: "Roast the profession — what the job says about them.",
    prodLines: [
      "Your job. What is it?",
      "You do something, right?",
    ],
  },
  {
    id: "where_from",
    question: "Where do you live?",
    vulgarQuestions: [
      "Where the hell do you live?",
      "Where you out of?",
    ],
    jokeContext: "Roast the place — stereotypes, what living there says about them.",
    prodLines: [
      "A town. A city. Anything.",
      "Where do you live? One word.",
    ],
  },
  {
    id: "single",
    question: "You married, or single?",
    vulgarQuestions: [
      "You got a husband or wife, or nobody?",
      "Married? Single? What's the story?",
    ],
    excludes: ["live_alone"],
    jokeContext: "Single = roast the solitude. Married/taken = roast the partner's judgment.",
    prodLines: [
      "Married or single. Pick one.",
      "Anyone in the picture?",
    ],
  },
  {
    id: "kids",
    question: "You got any kids?",
    vulgarQuestions: [
      "You got kids, or no?",
      "Any kids running around?",
    ],
    jokeContext: "Yes = roast the parental exhaustion. No = roast the freedom they're wasting on this.",
    prodLines: [
      "Yes or no.",
      "Kids? Yes or no?",
    ],
  },
  {
    id: "live_alone",
    question: "You live by yourself?",
    vulgarQuestions: [
      "You live alone, or with somebody?",
      "Anybody live with you?",
    ],
    excludes: ["single"],
    jokeContext: "Alone = roast the silence. With others = roast their tolerance.",
    prodLines: [
      "Alone, or with someone?",
      "Who's at home with you?",
    ],
  },
  {
    id: "coffee_tea",
    question: "Coffee or tea?",
    vulgarQuestions: [
      "Coffee or tea? Don't say neither.",
      "Coffee, tea — which is it?",
    ],
    jokeContext: "Coffee = wired disaster. Tea = trying to seem fancy. Neither = humblebrag.",
    prodLines: [
      "Coffee. Tea. Pick.",
      "One or the other.",
    ],
  },
  {
    id: "morning_night",
    question: "You a morning person?",
    vulgarQuestions: [
      "Morning person, or up all night?",
      "Early bird, or no?",
    ],
    jokeContext: "Morning = annoyingly chipper. Night = falling apart but romantically.",
    prodLines: [
      "Yes or no.",
      "Morning person or not?",
    ],
  },
  {
    id: "gym_couch",
    question: "You go to the gym, or no?",
    vulgarQuestions: [
      "Gym, or the couch?",
      "You work out, or who're we kidding?",
    ],
    jokeContext: "Gym = annoyingly disciplined. Couch = honest at least.",
    prodLines: [
      "Gym or couch. Easy.",
      "Lying won't make it true.",
    ],
  },
  {
    id: "cook_takeout",
    question: "You cook, or order in?",
    vulgarQuestions: [
      "You cook, or just call DoorDash?",
      "Home-cooked, or you can't find the oven?",
    ],
    jokeContext: "Cook = trying. Takeout = honest. Both = liar.",
    prodLines: [
      "Cook or takeout. Pick.",
      "One or the other.",
    ],
  },
];
