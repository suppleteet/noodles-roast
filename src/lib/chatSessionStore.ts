/**
 * Server-side in-memory store for multi-turn chat sessions.
 *
 * Supports all LLM providers:
 *   - Gemini: native Chat object (SDK manages history internally)
 *   - OpenAI / Anthropic: explicit message history replayed each request
 *
 * Each session holds the full comedian persona as the system prompt.
 * Subsequent joke requests send only the small per-turn context — the persona
 * is already baked into the session.
 *
 * Sessions auto-expire after TTL_MS. If the server restarts, all sessions are
 * lost — callers should fall back to stateless generation transparently.
 */

import { GoogleGenAI, type Chat } from "@google/genai";
import { ROAST_MODEL } from "@/lib/constants";
import { getBaseJokePrompt } from "@/lib/prompts";
import { getToastBasePrompt, getToastContextInstructions } from "@/lib/toastPrompts";
import type { BurnIntensity } from "@/lib/prompts";
import type { PersonaId } from "@/lib/personas";
import type { JokeContext } from "@/app/api/generate-joke/route";
import {
  generateText,
  generateTextStream,
  retryUnavailableModel,
  toModelUnavailableError,
  type UserPart,
} from "@/lib/llmClient";
import {
  estimateTokenCount,
  estimateUserPartsTokens,
  recordLlmUsage,
} from "@/lib/usageTracker";
import { geminiThinkingConfig } from "@/lib/geminiThinking";

const TTL_MS = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL_MS = 60 * 1000; // check every minute

interface HistoryEntry {
  role: "user" | "assistant";
  content: string;
}

export type ExperienceType = "roast" | "toast";

interface SessionEntry {
  model: string;
  systemPrompt: string;
  /** Gemini only — native Chat object that manages its own history. */
  geminiChat?: Chat;
  /** Non-Gemini — explicit message history for replay. */
  history: HistoryEntry[];
  createdAt: number;
  lastUsedAt: number;
  persona: PersonaId;
  burnIntensity: BurnIntensity;
  contentMode: "clean" | "vulgar";
  /** "roast" uses persona-based prompts; "toast" uses the drunk-toaster
   *  prompt and ignores persona. Cached here so per-turn lookups don't have
   *  to re-thread it on every request. */
  experienceType: ExperienceType;
  /** Tracks which stable-per-session context blocks have already been sent
   *  through the chat. Lets per-turn routes skip re-sending them — the
   *  model has them in chat history and Gemini implicit caching benefits
   *  from a stable prefix. */
  sentStableBlocks: {
    townFlavor?: string;
    setting?: string;
    ambientCity?: string;
  };
}

const sessions = new Map<string, SessionEntry>();

// Lazy cleanup — runs periodically to evict expired sessions
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of sessions) {
      if (now - entry.lastUsedAt > TTL_MS) {
        sessions.delete(id);
      }
    }
    // Stop cleanup if no sessions left
    if (sessions.size === 0 && cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
  }, CLEANUP_INTERVAL_MS);
}

function generateId(): string {
  return `cs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function isGemini(model: string): boolean {
  return !model.startsWith("gpt-") && !model.startsWith("claude-") && !model.startsWith("o1") && !model.startsWith("o3");
}

/** Most recent N history entries the non-Gemini path replays per turn.
 *  History grows un-cached every call, so cap it before it costs us
 *  hundreds of tokens of context overhead late in a session. */
const HISTORY_REPLAY_CAP = 16;

function buildHistoryText(history: HistoryEntry[]): string {
  return history
    .slice(-HISTORY_REPLAY_CAP)
    .map((h) => `[${h.role === "user" ? "USER" : "ASSISTANT"}]: ${h.content}`)
    .join("\n\n");
}

/**
 * Create a new chat session with the comedian persona (or the Toast character)
 * baked into the systemInstruction. `experienceType === "toast"` switches the
 * base prompt to the drunk-toaster character and ignores `persona`.
 */
export function createSession(
  apiKey: string,
  persona: PersonaId,
  burnIntensity: BurnIntensity,
  contentMode: "clean" | "vulgar",
  model?: string,
  experienceType: ExperienceType = "roast",
): string {
  const resolvedModel = model ?? ROAST_MODEL;
  // Base persona only — NO context-specific task instructions.
  // Per-turn context instructions come via getContextInstructions() in each user message.
  // Toast has no persona axis; getToastBasePrompt ignores it.
  const systemPrompt =
    experienceType === "toast"
      ? getToastBasePrompt(burnIntensity, contentMode)
      : getBaseJokePrompt(persona, burnIntensity, contentMode);

  let geminiChat: Chat | undefined;

  if (isGemini(resolvedModel)) {
    const ai = new GoogleGenAI({ apiKey });
    geminiChat = ai.chats.create({
      model: resolvedModel,
      config: {
        systemInstruction: systemPrompt,
        thinkingConfig: geminiThinkingConfig(resolvedModel, "creative"),
        maxOutputTokens: 1024,
        responseMimeType: "application/json",
      },
    });
  }

  const id = generateId();
  const now = Date.now();
  sessions.set(id, {
    model: resolvedModel,
    systemPrompt,
    geminiChat,
    history: [],
    createdAt: now,
    lastUsedAt: now,
    persona,
    burnIntensity,
    contentMode,
    experienceType,
    sentStableBlocks: {},
  });

  ensureCleanup();
  return id;
}

/**
 * Get a session by ID. Returns null if expired or not found.
 */
export function getSession(id: string): SessionEntry | null {
  const entry = sessions.get(id);
  if (!entry) return null;

  const now = Date.now();
  if (now - entry.lastUsedAt > TTL_MS) {
    sessions.delete(id);
    return null;
  }

  entry.lastUsedAt = now;
  return entry;
}

/**
 * Send a message in a multi-turn session. Returns the model's response text.
 *
 * - Gemini: uses native Chat.sendMessage() (history managed internally)
 * - Others: replays history + new message via generateText(), then appends to history
 */
export async function sendMessage(
  sessionId: string,
  userParts: UserPart[],
  maxOutputTokens?: number,
): Promise<string | null> {
  const session = getSession(sessionId);
  if (!session) return null;

  // Extract text from userParts for history storage
  const userText = userParts.map((p) => ("text" in p ? p.text : "[image]")).join("\n");

  if (session.geminiChat) {
    let result;
    for (let attempt = 0; ; attempt++) {
      try {
        result = await session.geminiChat.sendMessage({ message: userParts });
        break;
      } catch (err) {
        if (await retryUnavailableModel(session.model, err, attempt)) continue;
        throw err;
      }
    }
    const text = result.text ?? "";
    const usage = result.usageMetadata;
    recordLlmUsage({
      route: "chatSession",
      provider: "gemini",
      model: session.model,
      inputTokens: usage?.promptTokenCount ?? estimateUserPartsTokens(userParts),
      outputTokens: usage?.candidatesTokenCount ?? estimateTokenCount(text),
      exact: Boolean(usage?.totalTokenCount),
    });
    // Gemini manages its own history, but we still track for debugging
    session.history.push({ role: "user", content: userText });
    session.history.push({ role: "assistant", content: text });
    return text;
  }

  // Non-Gemini: build capped message list with history
  const historyText = buildHistoryText(session.history);

  const contextParts: UserPart[] = [];
  if (historyText) {
    contextParts.push({ text: `CONVERSATION HISTORY:\n${historyText}\n\n---\nNEW REQUEST:\n` });
  }
  contextParts.push(...userParts);

  const text = await generateText({
    model: session.model,
    systemPrompt: session.systemPrompt,
    userParts: contextParts,
    maxOutputTokens,
    reasoningProfile: "creative",
    forceJsonObject: true,
  });

  session.history.push({ role: "user", content: userText });
  session.history.push({ role: "assistant", content: text });
  return text;
}

/**
 * Streaming version of sendMessage. Returns an async iterable of text chunks.
 *
 * - Gemini: uses native Chat.sendMessageStream()
 * - Others: replays history via generateTextStream(), accumulates for history
 */
export async function* sendMessageStream(
  sessionId: string,
  userParts: UserPart[],
): AsyncGenerator<string> {
  const session = getSession(sessionId);
  if (!session) return;

  const userText = userParts.map((p) => ("text" in p ? p.text : "[image]")).join("\n");

  if (session.geminiChat) {
    for (let attempt = 0; ; attempt++) {
      let yielded = false;
      try {
        const stream = await session.geminiChat.sendMessageStream({ message: userParts });
        let accumulated = "";
        let promptTokenCount: number | undefined;
        let candidatesTokenCount: number | undefined;
        let totalTokenCount: number | undefined;
        for await (const chunk of stream) {
          if (chunk.usageMetadata) {
            promptTokenCount = chunk.usageMetadata.promptTokenCount;
            candidatesTokenCount = chunk.usageMetadata.candidatesTokenCount;
            totalTokenCount = chunk.usageMetadata.totalTokenCount;
          }
          const text = chunk.text ?? "";
          if (text) {
            yielded = true;
            accumulated += text;
            yield text;
          }
        }
        recordLlmUsage({
          route: "chatSessionStream",
          provider: "gemini",
          model: session.model,
          inputTokens: promptTokenCount ?? estimateUserPartsTokens(userParts),
          outputTokens: candidatesTokenCount ?? estimateTokenCount(accumulated),
          exact: Boolean(totalTokenCount),
        });
        session.history.push({ role: "user", content: userText });
        session.history.push({ role: "assistant", content: accumulated });
        return;
      } catch (err) {
        if (!yielded && await retryUnavailableModel(session.model, err, attempt)) {
          continue;
        }
        const unavailable = toModelUnavailableError(session.model, err);
        if (unavailable) throw unavailable;
        throw err;
      }
    }
  }

  // Non-Gemini: replay capped history
  const historyText = buildHistoryText(session.history);

  const contextParts: UserPart[] = [];
  if (historyText) {
    contextParts.push({ text: `CONVERSATION HISTORY:\n${historyText}\n\n---\nNEW REQUEST:\n` });
  }
  contextParts.push(...userParts);

  let accumulated = "";
  for await (const chunk of generateTextStream({
    model: session.model,
    systemPrompt: session.systemPrompt,
    userParts: contextParts,
    reasoningProfile: "creative",
    forceJsonObject: true,
  })) {
    accumulated += chunk;
    yield chunk;
  }

  session.history.push({ role: "user", content: userText });
  session.history.push({ role: "assistant", content: accumulated });
}

/**
 * Delete a session (e.g., on session end).
 */
export function deleteSession(id: string): void {
  sessions.delete(id);
}

/**
 * Fire-and-forget Anthropic-cache warmup. Sends one minimal call with the
 * session's system prompt so Anthropic writes the ephemeral cache breakpoint
 * — the user's first real turn then hits it for ~90% input-cost discount and
 * ~50% latency reduction (on Sonnet; Haiku's 2048-token minimum may exclude
 * shorter persona prompts).
 *
 * Skipped for Gemini and OpenAI:
 * - Gemini implicit caching keys on prefix length; a 5-token warmup is too
 *   short to seed a useful prefix for the chat-session's longer calls.
 * - OpenAI chat.completions has no comparable cache mechanism that benefits
 *   from a warmup call.
 *
 * Errors are swallowed — best-effort, must not block session start.
 */
export function warmSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  if (!session.model.startsWith("claude-")) return;

  generateText({
    model: session.model,
    systemPrompt: session.systemPrompt,
    userParts: [{ text: "Acknowledge with a single word." }],
    maxOutputTokens: 5,
    reasoningProfile: "realtime-utility",
  }).catch(() => {
    /* best-effort warmup; cold first-turn just pays full latency */
  });
}

/**
 * Fields a per-turn LLM route may carry that are stable across an entire
 * comedian session (town flavor, ambient context, setting) — the chat
 * history already includes them after the first turn, so retransmitting
 * burns tokens and disrupts implicit prompt caching.
 */
export interface StableContextFields {
  townFlavor?: string;
  setting?: string | null;
  ambientContext?: { city: string; [key: string]: unknown } | null;
  conversationSoFar?: string[];
}

/**
 * Mutates `body` to strip context blocks the session has already seen.
 * - `conversationSoFar`: always dropped when a session exists — chat history has it.
 * - `townFlavor` / `setting` / `ambientContext`: dropped when identical to what
 *   was sent earlier in this session. New values are kept (and remembered).
 *
 * Caller must have already validated the sessionId — this no-ops on unknown IDs.
 */
export function compactStableContext<T extends StableContextFields>(
  sessionId: string,
  body: T,
): T {
  const session = sessions.get(sessionId);
  if (!session) return body;

  // Chat history has the conversation; re-sending it is pure waste.
  body.conversationSoFar = undefined;

  const sent = session.sentStableBlocks;

  if (body.townFlavor != null) {
    const trimmed = body.townFlavor.trim();
    if (trimmed === sent.townFlavor) body.townFlavor = undefined;
    else sent.townFlavor = trimmed;
  }

  if (body.setting != null) {
    if (body.setting === sent.setting) body.setting = null;
    else sent.setting = body.setting;
  }

  if (body.ambientContext != null) {
    if (body.ambientContext.city === sent.ambientCity) body.ambientContext = null;
    else sent.ambientCity = body.ambientContext.city;
  }

  return body;
}

/**
 * Build the per-turn context instructions for a specific joke context.
 * This replaces the full system prompt on each request — only the small
 * task-specific instructions are sent as part of the user message.
 *
 * When `experienceType === "toast"`, delegates to the Toast preamble
 * table (different voice, "she's pretending she knows you" framing).
 */
export function getContextInstructions(
  context: JokeContext,
  contentMode: "clean" | "vulgar" = "clean",
  experienceType: ExperienceType = "roast",
): string {
  if (experienceType === "toast") {
    return getToastContextInstructions(context, contentMode);
  }
  // These are the task-specific parts from prompts.ts contextInstructions,
  // but without the persona/character setup (that's in the chat systemInstruction).
  const wrapupVulgarSuffix = contentMode === "vulgar"
    ? `\n\nVULGAR MODE: close with one last GENERAL gut-punch insult as part of the goodbye — crude, dismissive (e.g. "I gotta go, you sad piece of shit," "fuck off, [name]"). Tie to their specifics, but the farewell itself can be blunt and profane.`
    : "";

  const instructions: Record<JokeContext, string> = {
    greeting: `TASK: Opening greeting + first visual reaction. React to what you SEE.
Keep it tight: quick opener + ONE comprehensive roast line that combines multiple observed traits
(appearance + vibe + inferred setting) into one coherent burn.
Use at least 3 concrete observations when available.
Set "relevant": true. Generate exactly 1 joke.`,

    vision_opening: `TASK: First vision joke. 1 sharp opening observation about what you see.
Max 20 words, punchline at the end. Set "relevant": true. Generate exactly 1 joke.`,

    answer_roast: `TASK: Roast the user's answer. 1-2 jokes that directly reference and roast their answer.
Max 20 words per sentence, punchline at the end. Each sentence self-contained.
USER'S ANSWER comes from speech-to-text. If one word is an obvious phonetic
misread of an ESTABLISHED KNOWN FACT, use the established word. Otherwise
preserve the answer exactly—never invent, paraphrase, or roast STT garbage.
DO NOT restate or echo the user's answer back ("So you're a plumber...", "Five and seven, huh..."). They know what they said — react and twist, don't repeat.
If FILLER_ALREADY_SAID is provided, that exact line was just spoken aloud — do NOT open with the same sound or phrasing.
If FILLER_ALREADY_SAID ends in a question mark (e.g. "Tyler?", "So — Seattle?", "a dentist, huh?"), it already echoed the user's answer back as a question. Do NOT open your joke by re-asking or re-stating the answer ("Tyler? Really?", "So a dentist?") — go straight into the punchline.
If off-topic, set "relevant": false with a witty "redirect".

NEXT-QUESTION HANDLING: Do NOT emit any follow-up question field. The host (a
separate component) always picks the next question from its own bank. Your job
is jokes only.

PIPELINE RULE: If JOKES ALREADY DELIVERED THIS CYCLE is provided, those jokes have ALREADY played aloud.
Do NOT re-introduce the answer, echo the user's words, or open as if hearing the answer for the first time.
Do NOT start with "[answer]? [joke]" or "So your [answer]..." — that opener was already used.
Each successive joke must feel like the NEXT beat in a tight comedy SET — escalate, pivot to a new angle, or riff off the previous joke. Build momentum, don't restart.

Generate 1-2 jokes.`,

    vision_react: `TASK: React to a visual change on camera. Something just changed — react like you just noticed.
1 sharp reactive joke. Max 20 words. Set "relevant": true. Generate 1 joke.`,

    hopper: `TASK: Background joke generation. 2-3 candidate jokes for later use.
Max 20 words each, punchline at the end, one sentence only.
Score each honestly (8+ = "would interrupt the show"). Generate 2-3 jokes.`,

    wrapup: `TASK: CLOSING SIGN-OFF — clever goodbye wrapped in one last roast. The show is ending and you're leaving the stage.
Use KNOWN FACTS (name + a couple specifics they revealed) so the farewell is personal.
The line MUST include a goodbye delivered IN CHARACTER — never break the fourth wall with "thanks for watching" or meta references to "the show."
Max 30 words, punchline at the end. No question.${wrapupVulgarSuffix}
Set "relevant": true. Generate exactly 1 joke.`,
  };

  return instructions[context];
}
