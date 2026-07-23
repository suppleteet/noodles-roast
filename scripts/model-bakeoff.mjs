#!/usr/bin/env node

const baseUrl = process.env.ROASTIE_BASE_URL?.trim() || "http://localhost:3000";
const models = (
  process.env.ROASTIE_BAKEOFF_MODELS ||
  [
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "claude-sonnet-4-6",
    "gemini-3.5-flash-lite",
  ].join(",")
)
  .split(",")
  .map((model) => model.trim())
  .filter(Boolean);
const repetitions = Math.max(1, Number(process.env.ROASTIE_BAKEOFF_REPETITIONS || 2));
const warmupRounds = Math.max(0, Number(process.env.ROASTIE_BAKEOFF_WARMUPS || 1));

const cases = [
  {
    id: "startup-engineer",
    question: "What do you do?",
    userAnswer: "I'm a software engineer at a startup",
    observations: ["man in his 30s", "black hoodie", "tired expression"],
    setting: "home office",
    knownFacts: ["name:Alex"],
  },
  {
    id: "cats-and-guitar",
    question: "What do you do for fun?",
    userAnswer: "I play guitar badly and have two cats named Pickle and Biscuit",
    observations: ["woman in her 40s", "floral sweater", "skeptical expression"],
    setting: "kitchen",
    knownFacts: ["name:Maya"],
  },
];

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

async function createSession(model) {
  const response = await fetch(`${baseUrl}/api/comedian-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      persona: "kvetch",
      burnIntensity: 5,
      contentMode: "clean",
      experienceType: "roast",
    }),
  });
  const body = await response.json();
  if (!response.ok || !body.sessionId) {
    throw new Error(`session ${response.status}: ${body.error || "request failed"}`);
  }
  return body.sessionId;
}

async function deleteSession(sessionId) {
  await fetch(`${baseUrl}/api/comedian-session`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  }).catch(() => {});
}

async function runCase(model, sample, sessionId, repetition) {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}/api/generate-joke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      context: "answer_roast",
      model,
      sessionId,
      persona: "kvetch",
      burnIntensity: 5,
      contentMode: "clean",
      question: sample.question,
      userAnswer: sample.userAnswer,
      observations: sample.observations,
      setting: sample.setting,
      knownFacts: sample.knownFacts,
      maxJokes: 2,
    }),
  });
  const latencyMs = Math.round(performance.now() - startedAt);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`${response.status}: ${body.detail || body.error || "request failed"}`);
  }

  const jokes = Array.isArray(body.jokes)
    ? body.jokes.map((joke) => String(joke.text || "")).filter(Boolean)
    : [];
  return {
    model,
    case: sample.id,
    repetition,
    latencyMs,
    jokes,
    lines: jokes.length,
    linesAtOrUnder20Words: jokes.filter((joke) => wordCount(joke) <= 20).length,
  };
}

const results = [];
const sessions = new Map();
try {
  for (const model of models) {
    try {
      sessions.set(model, await createSession(model));
    } catch (error) {
      console.error(`[session] ${model} — ERROR: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Unmeasured warm-up rounds remove provider/session cold-start order bias.
  for (let round = 0; round < warmupRounds; round++) {
    for (const model of [...models].sort(() => Math.random() - 0.5)) {
      const sessionId = sessions.get(model);
      if (!sessionId) continue;
      await runCase(model, cases[round % cases.length], sessionId, `warmup-${round + 1}`)
        .catch(() => {});
    }
  }

  const tasks = [];
  for (let repetition = 1; repetition <= repetitions; repetition++) {
    for (const sample of cases) {
      for (const model of models) tasks.push({ model, sample, repetition });
    }
  }
  tasks.sort(() => Math.random() - 0.5);

  for (const { model, sample, repetition } of tasks) {
    const sessionId = sessions.get(model);
    if (!sessionId) {
      results.push({ model, case: sample.id, repetition, error: "session unavailable" });
      continue;
    }
    try {
      const result = await runCase(model, sample, sessionId, repetition);
      results.push(result);
      console.log(`\n[${sample.id} #${repetition}] ${model} — ${result.latencyMs}ms`);
      result.jokes.forEach((joke, index) => {
        console.log(`  ${index + 1}. (${wordCount(joke)}w) ${joke}`);
      });
    } catch (error) {
      results.push({
        model,
        case: sample.id,
        repetition,
        error: error instanceof Error ? error.message : String(error),
      });
      console.error(`\n[${sample.id} #${repetition}] ${model} — ERROR: ${results.at(-1).error}`);
    }
  }
} finally {
  await Promise.all([...sessions.values()].map((sessionId) => deleteSession(sessionId)));
}

const summary = models.map((model) => {
  const successful = results.filter(
    (result) => result.model === model && !("error" in result),
  );
  const failed = results.length
    ? results.filter((result) => result.model === model && "error" in result).length
    : 0;
  const totalLines = successful.reduce((sum, result) => sum + result.lines, 0);
  const compliantLines = successful.reduce(
    (sum, result) => sum + result.linesAtOrUnder20Words,
    0,
  );
  return {
    model,
    averageLatencyMs: successful.length
      ? Math.round(
          successful.reduce((sum, result) => sum + result.latencyMs, 0) /
            successful.length,
        )
      : null,
    structuralCompliance: totalLines
      ? `${compliantLines}/${totalLines} lines <=20 words`
      : "n/a",
    failures: failed,
  };
});

console.log("\nSummary (judge joke quality from the material above):");
console.table(summary);

if (results.some((result) => "error" in result)) {
  process.exitCode = 1;
}
