/**
 * Real Roastie API-path benchmark.
 *
 * Hits the same local Next routes used by live sessions:
 * - /api/comedian-session
 * - /api/generate-speak
 * - /api/rephrase-question
 * - /api/generate-question
 *
 * Usage:
 *   node scripts/bench-real-roastie-path.mjs
 *
 * Optional env:
 *   BASE_URL=http://localhost:3000
 *   RUNS_PER_CASE=1
 */

import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { performance } from "perf_hooks";

function loadDotEnv(filePath) {
  try {
    const env = fs.readFileSync(filePath, "utf8");
    for (const line of env.split(/\r?\n/)) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match && !process.env[match[1].trim()]) {
        process.env[match[1].trim()] = match[2].trim();
      }
    }
  } catch {
    // No local env file.
  }
}

loadDotEnv(path.join(process.cwd(), ".env.local"));

const baseUrl = (process.env.BASE_URL ?? "http://localhost:3001").replace(/\/$/, "");
const runsPerCase = Math.max(1, Number(process.env.RUNS_PER_CASE ?? "1"));

const variants = [
  { key: "gemini-3.5-flash", label: "Gemini 3.5 Flash", model: "gemini-3.5-flash" },
  { key: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite", model: "gemini-3.1-flash-lite" },
  { key: "gpt-4o", label: "GPT-4o", model: "gpt-4o" },
  { key: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", model: "claude-sonnet-4-6" },
  { key: "claude-haiku-4-5", label: "Claude Haiku 4.5", model: "claude-haiku-4-5-20251001" },
];

const commonContext = {
  persona: "kvetch",
  burnIntensity: 5,
  contentMode: "vulgar",
  observations: [
    "wearing glasses",
    "has a beard",
    "wearing a hoodie",
    "home office setting",
    "posters or art visible on wall",
  ],
  setting: "home office",
  knownFacts: ["name:Tyler", "job:director", "city:Woodacre"],
  ambientContext: {
    city: "Woodacre",
    region: "California",
    timeOfDay: "late morning",
    localTime: "11:20 AM",
    weather: "overcast",
    tempF: 58,
  },
  townFlavor:
    "Small wooded Marin town energy: fog, expensive quiet, wellness people, artists, and outdoor gear that costs more than rent.",
};

const answerCases = [
  {
    label: "Name with greeting context",
    question: "Alright, before I waste another second looking at you - what do I call you?",
    userAnswer: "My name is Tyler.",
    fillerAlreadySaid: "My name is Tyler. Hm.",
    knownFacts: [],
    conversationSoFar: [
      "[joke] Jesus Christ, you look like a melted candle from a gas station bathroom.",
      "[question] Alright, before I waste another second looking at you - what do I call you?",
      "[answer] My name is Tyler.",
    ],
  },
  {
    label: "Director answer with visual context",
    question: "What exactly were you going for here, or were you just closing your eyes and hoping for the best?",
    userAnswer: "It's really special to me. I made these projects. I'm a director.",
    fillerAlreadySaid: "Uh huh.",
    knownFacts: ["name:Tyler"],
    conversationSoFar: [
      "[question] What's all that stuff on the wall behind you?",
      "[answer] Those are my special art projects I made.",
      "[joke] Tyler made art projects. The kind of sentence that explains everything wrong with Tyler.",
    ],
  },
  {
    label: "Correction recovery",
    question: "What are all those posters behind you?",
    userAnswer: "The festival in New York called Tribeca.",
    fillerAlreadySaid: "in New York, huh.",
    jokesAlreadyDelivered: [
      "Sundance rejected you, Tyler. That's not a badge of honor, that's a restraining order with a gift shop.",
      "\"Try back up\" - forty years I've been alive and that's the saddest three words I've ever heard.",
    ],
    knownFacts: ["name:Tyler", "job:director"],
    conversationSoFar: [
      "[answer] They were showing at Sundance and try back up.",
      "[joke] Sundance rejected you, Tyler. That's not a badge of honor.",
      "[answer] No, I said try Becca.",
      "[answer] The festival in New York called Tribeca.",
    ],
  },
  {
    label: "Bad habit safe premise",
    question: "What's your worst habit that you pretend is a personality?",
    userAnswer: "I over-explain everything.",
    fillerAlreadySaid: "Ohhh.",
    knownFacts: ["name:Tyler", "job:director"],
    conversationSoFar: [
      "[question] What's your worst habit that you pretend is a personality?",
      "[answer] I over-explain everything.",
    ],
  },
  {
    label: "Hobby with callback",
    question: "What do you do when nobody is making you be useful?",
    userAnswer: "I restore old arcade machines.",
    fillerAlreadySaid: "Mmhmm.",
    knownFacts: ["name:Tyler", "job:director"],
    conversationSoFar: [
      "[joke] Directors have a vision, Tyler. You have glue sticks and feelings.",
      "[question] What do you do when nobody is making you be useful?",
      "[answer] I restore old arcade machines.",
    ],
  },
];

const questionCases = [
  {
    label: "Avoid repeated wall/poster topic",
    observations: commonContext.observations,
    setting: "home office",
    knownFacts: commonContext.knownFacts,
    conversationSoFar: [
      "[question] What's all that stuff on the wall behind you?",
      "[answer] Those are my special art projects.",
      "[question] What are all those posters behind you?",
      "[answer] They're projects that showed at Tribeca.",
    ],
  },
  {
    label: "Office contextual question",
    observations: ["wearing headphones", "desk microphone visible", "home office setting", "focused expression"],
    setting: "home office",
    knownFacts: ["name:Tyler"],
    conversationSoFar: [
      "[question] What's your name?",
      "[answer] Tyler",
      "[joke] Tyler sounds like a refund request with shoes.",
    ],
  },
];

const rephraseCases = [
  {
    label: "Bad habit rephrase",
    question: "What's your worst habit that you pretend is a personality?",
    knownFacts: ["name:Tyler", "job:director"],
    previousLine: "A director with glue sticks and feelings. Fantastic.",
  },
  {
    label: "Free-time rephrase",
    question: "What do you do when nobody is making you be useful?",
    knownFacts: ["name:Tyler"],
    previousLine: "Your office has the emotional range of a DMV printer.",
  },
];

async function postJson(pathname, body) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const elapsedMs = performance.now() - started;
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Some errors are plain text.
  }
  return { ok: response.ok, status: response.status, elapsedMs, text, json };
}

async function createSession(variant) {
  return postJson("/api/comedian-session", {
    persona: commonContext.persona,
    burnIntensity: commonContext.burnIntensity,
    contentMode: commonContext.contentMode,
    model: variant.model,
    reasoningEffort: variant.reasoningEffort,
  });
}

function parseSseEvents(buffer) {
  const events = [];
  for (const block of buffer.split(/\n\n/)) {
    const line = block.split(/\n/).find((l) => l.startsWith("data: "));
    if (!line) continue;
    try {
      events.push(JSON.parse(line.slice(6)));
    } catch {
      events.push({ type: "parse_error", raw: line.slice(6) });
    }
  }
  return events;
}

async function generateSpeak(variant, sessionId, scenario, runIndex) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}/api/generate-speak`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      context: "answer_roast",
      sessionId,
      model: variant.model,
      reasoningEffort: variant.reasoningEffort,
      persona: commonContext.persona,
      burnIntensity: commonContext.burnIntensity,
      contentMode: commonContext.contentMode,
      observations: commonContext.observations,
      setting: commonContext.setting,
      ambientContext: commonContext.ambientContext,
      townFlavor: commonContext.townFlavor,
      maxJokes: 1,
      ...scenario,
      knownFacts: scenario.knownFacts ?? commonContext.knownFacts,
    }),
  });

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let firstByteMs = null;
  let firstJokeMs = null;
  let lastEventCount = 0;
  const events = [];

  if (!reader) {
    return {
      ok: false,
      route: "generate-speak",
      variant: variant.key,
      label: variant.label,
      scenario: scenario.label,
      runIndex,
      status: response.status,
      totalMs: performance.now() - started,
      error: "No response body",
      events,
      jokes: [],
    };
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (firstByteMs === null) firstByteMs = performance.now() - started;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSseEvents(buffer);
    for (const event of parsed.slice(lastEventCount)) {
      events.push(event);
      if (event.type === "joke" && firstJokeMs === null) {
        firstJokeMs = performance.now() - started;
      }
    }
    lastEventCount = parsed.length;
  }

  const totalMs = performance.now() - started;
  const jokes = events.filter((e) => e.type === "joke").map((e) => e.text).filter(Boolean);
  const meta = events.find((e) => e.type === "meta") ?? null;
  const error = events.find((e) => e.type === "error") ?? null;

  return {
    ok: response.ok && jokes.length > 0 && !error,
    route: "generate-speak",
    variant: variant.key,
    label: variant.label,
    model: variant.model,
    reasoningEffort: variant.reasoningEffort ?? null,
    scenario: scenario.label,
    runIndex,
    status: response.status,
    firstByteMs,
    firstJokeMs,
    totalMs,
    jokes,
    meta,
    error,
    raw: buffer,
  };
}

function questionIssues(question) {
  const q = String(question ?? "").toLowerCase();
  const issues = [];
  if (/\b(behind you|back there|wall|poster|posters|art|stuff|things|items|objects)\b/.test(q)) {
    issues.push("background-repeat-risk");
  }
  if (/\bor\b[^?]*\?/.test(q)) {
    issues.push("multiple-choice-risk");
  }
  return issues;
}

async function benchQuestionRoute(variant, scenario, runIndex) {
  const result = await postJson("/api/generate-question", {
    model: variant.model,
    reasoningEffort: variant.reasoningEffort,
    persona: commonContext.persona,
    observations: scenario.observations,
    setting: scenario.setting,
    knownFacts: scenario.knownFacts,
    conversationSoFar: scenario.conversationSoFar,
  });
  const question = result.json?.question ?? "";
  return {
    ok: result.ok && Boolean(question),
    route: "generate-question",
    variant: variant.key,
    label: variant.label,
    scenario: scenario.label,
    runIndex,
    status: result.status,
    totalMs: result.elapsedMs,
    question,
    jokeContext: result.json?.jokeContext,
    issues: questionIssues(question),
    error: result.ok ? null : result.text,
  };
}

async function benchRephraseRoute(variant, scenario, runIndex) {
  const result = await postJson("/api/rephrase-question", {
    model: variant.model,
    reasoningEffort: variant.reasoningEffort,
    persona: commonContext.persona,
    burnIntensity: commonContext.burnIntensity,
    question: scenario.question,
    knownFacts: scenario.knownFacts,
    previousLine: scenario.previousLine,
  });
  const rephrased = result.json?.rephrased ?? "";
  return {
    ok: result.ok && Boolean(rephrased),
    route: "rephrase-question",
    variant: variant.key,
    label: variant.label,
    scenario: scenario.label,
    runIndex,
    status: result.status,
    totalMs: result.elapsedMs,
    rephrased,
    error: result.ok ? null : result.text,
  };
}

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

async function judgeJokes(speakResults) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return {};

  const candidates = speakResults.flatMap((result) =>
    result.jokes.map((joke, index) => ({
      key: `${result.variant}|${result.scenario}|${result.runIndex}|${index}`,
      variant: result.variant,
      scenario: result.scenario,
      joke,
    })),
  );
  if (candidates.length === 0) return {};

  const shuffled = [...candidates].sort(() => Math.random() - 0.5);
  const list = shuffled.map((item, index) => `${index + 1}. (${item.scenario}) "${item.joke}"`).join("\n");

  const client = new OpenAI({ apiKey });
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    max_completion_tokens: 5000,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You judge roast jokes for a live puppet comedy show. Score 1-10 for specificity, originality, brevity, character voice, and punchline. Be harsh. Return only JSON: {\"scores\":[{\"n\":1,\"score\":7,\"note\":\"brief reason\"}]}",
      },
      { role: "user", content: `Judge these jokes blind. The n values must match the list.\n\n${list}` },
    ],
  });

  const parsed = extractJson(response.choices[0]?.message?.content ?? "");
  const scores = {};
  for (const score of parsed?.scores ?? []) {
    const original = shuffled[Number(score.n) - 1];
    if (original) scores[original.key] = { score: Number(score.score), note: String(score.note ?? "") };
  }
  return scores;
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

function summarize(speakResults, questionResults, rephraseResults, scores) {
  return variants.map((variant) => {
    const rows = speakResults.filter((r) => r.variant === variant.key);
    const okRows = rows.filter((r) => r.ok);
    const firstJokes = okRows.map((r) => r.firstJokeMs).filter((n) => typeof n === "number");
    const totals = okRows.map((r) => r.totalMs);
    const scored = okRows
      .flatMap((r) => r.jokes.map((_, index) => scores[`${r.variant}|${r.scenario}|${r.runIndex}|${index}`]?.score))
      .filter((score) => typeof score === "number" && Number.isFinite(score));
    const avgFirstJokeMs = firstJokes.length ? firstJokes.reduce((a, b) => a + b, 0) / firstJokes.length : 0;
    const avgTotalMs = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : 0;
    const avgScore = scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : 0;
    const qRows = questionResults.filter((r) => r.variant === variant.key);
    const rRows = rephraseResults.filter((r) => r.variant === variant.key);

    return {
      variant: variant.key,
      label: variant.label,
      speakOk: okRows.length,
      speakTotal: rows.length,
      questionOk: qRows.filter((r) => r.ok).length,
      questionTotal: qRows.length,
      rephraseOk: rRows.filter((r) => r.ok).length,
      rephraseTotal: rRows.length,
      avgFirstJokeMs,
      p50FirstJokeMs: percentile(firstJokes, 0.5),
      avgTotalMs,
      avgScore,
      scorePerSecond: avgFirstJokeMs > 0 ? avgScore / (avgFirstJokeMs / 1000) : 0,
      questionIssues: qRows.reduce((sum, r) => sum + (r.issues?.length ?? 0), 0),
    };
  });
}

function printSummary(summary) {
  console.log("\nREAL ROASTIE API-PATH BENCHMARK");
  console.log("Variant                 speak  q/r   first ms  total ms  score  score/sec  q issues");
  console.log("--------------------------------------------------------------------------------------");
  for (const row of summary) {
    console.log(
      `${row.label.padEnd(23)} ` +
      `${String(row.speakOk).padStart(2)}/${String(row.speakTotal).padEnd(2)} ` +
      `${String(row.questionOk).padStart(1)}/${row.questionTotal}+${String(row.rephraseOk).padStart(1)}/${row.rephraseTotal} ` +
      `${row.avgFirstJokeMs.toFixed(0).padStart(9)} ` +
      `${row.avgTotalMs.toFixed(0).padStart(9)} ` +
      `${row.avgScore.toFixed(2).padStart(6)} ` +
      `${row.scorePerSecond.toFixed(2).padStart(10)} ` +
      `${String(row.questionIssues).padStart(8)}`,
    );
  }
}

async function ensureServer() {
  try {
    const response = await fetch(`${baseUrl}/api/debug-usage`, { signal: AbortSignal.timeout(5000) });
    if (response.ok) return;
  } catch {
    // Fall through.
  }
  throw new Error(`No local Roastie server responded at ${baseUrl}. Start it with npm run dev.`);
}

async function main() {
  await ensureServer();

  console.log(`Running real API-path benchmark at ${baseUrl}`);
  console.log(`${runsPerCase} run(s) per case, ${variants.length} variants.`);

  const speakResults = [];
  const questionResults = [];
  const rephraseResults = [];
  const sessionResults = [];

  for (const variant of variants) {
    console.log(`\n${variant.label}`);
    const session = await createSession(variant);
    sessionResults.push({ variant: variant.key, ...session });
    if (!session.ok || !session.json?.sessionId) {
      console.log(`  session failed: ${session.status} ${session.text.slice(0, 120)}`);
      continue;
    }

    for (let runIndex = 0; runIndex < runsPerCase; runIndex++) {
      for (const scenario of rephraseCases) {
        const result = await benchRephraseRoute(variant, scenario, runIndex);
        rephraseResults.push(result);
        console.log(`  rephrase ${scenario.label}: ${result.totalMs.toFixed(0)}ms - ${result.rephrased.slice(0, 70) || result.error}`);
      }

      for (const scenario of questionCases) {
        const result = await benchQuestionRoute(variant, scenario, runIndex);
        questionResults.push(result);
        const issueText = result.issues.length ? ` [${result.issues.join(", ")}]` : "";
        console.log(`  question ${scenario.label}: ${result.totalMs.toFixed(0)}ms - ${result.question.slice(0, 70)}${issueText}`);
      }

      for (const scenario of answerCases) {
        const result = await generateSpeak(variant, session.json.sessionId, scenario, runIndex);
        speakResults.push(result);
        const timing = `${(result.firstJokeMs ?? result.totalMs).toFixed(0)}ms first / ${result.totalMs.toFixed(0)}ms total`;
        const detail = result.ok ? result.jokes[0].slice(0, 90) : (result.error?.detail ?? result.error?.error ?? result.raw ?? "failed");
        console.log(`  speak ${scenario.label}: ${timing} - ${detail}`);
      }
    }
  }

  console.log("\nJudging generated jokes blind...");
  const scores = await judgeJokes(speakResults);
  const summary = summarize(speakResults, questionResults, rephraseResults, scores);
  printSummary(summary);

  fs.mkdirSync(".debug", { recursive: true });
  const reportPath = path.join(".debug", `real-roastie-path-benchmark-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(
    reportPath,
    JSON.stringify({
      createdAt: new Date().toISOString(),
      baseUrl,
      runsPerCase,
      variants,
      answerCases,
      questionCases,
      rephraseCases,
      sessionResults,
      rephraseResults,
      questionResults,
      speakResults,
      scores,
      summary,
    }, null, 2),
  );
  console.log(`\nSaved report: ${reportPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
