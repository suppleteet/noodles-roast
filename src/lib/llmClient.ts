/**
 * LLM Client Adapter — thin dispatch layer for multi-provider joke generation.
 *
 * Supports Gemini, OpenAI, and Anthropic. Each route calls generateText() or
 * generateTextStream() with a model ID; this module picks the right SDK.
 *
 * Provider-specific quirks are handled here so API routes stay provider-agnostic.
 */

import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import {
  estimateTokenCount,
  estimateUserPartsTokens,
  recordLlmUsage,
} from "@/lib/usageTracker";

// ─── Types ──────────────────────────────────────────────────────────────────────

export type UserPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

export interface LlmRequest {
  model: string;
  systemPrompt: string;
  userParts: UserPart[];
  maxOutputTokens?: number;
  /** OpenAI only: force JSON object response. Defaults to false. */
  forceJsonObject?: boolean;
}

type Provider = "gemini" | "openai" | "anthropic";

// ─── Quota error detection ──────────────────────────────────────────────────────

/**
 * Thrown when an LLM provider rejects a request due to exhausted credits,
 * billing issues, or quota limits. Callers can check `instanceof QuotaError`
 * to surface a user-friendly message instead of a generic "API failed".
 */
export class QuotaError extends Error {
  constructor(public provider: Provider, detail: string) {
    super(`${provider} quota/billing error: ${detail}`);
    this.name = "QuotaError";
  }
}

/**
 * Patterns that indicate billing exhaustion (not temporary rate limiting).
 * 429 alone is NOT sufficient — Gemini returns 429 for both per-minute rate
 * limits (temporary, retryable) and billing quota (billing issue). We only
 * treat 429 as billing if the message contains one of these patterns.
 * 402 (Payment Required) is always billing.
 */
const QUOTA_PATTERNS = [
  /insufficient.?quota/i,           // OpenAI: insufficient_quota code
  /exceeded.*quota/i,               // "exceeded your quota"
  /exceeded your current usage/i,   // OpenAI billing message
  /billing.{0,30}(not enabled|required|failed|issue)/i,
  /(insufficient|not enough|low|out of).{0,20}credits/i,
  /credit balance.{0,20}too low/i,  // Anthropic low-balance message
  /payment.{0,20}(required|failed|declined)/i,
];

const TRANSIENT_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [250, 600];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toQuotaError(provider: Provider, err: unknown): QuotaError | null {
  const status = (err as { status?: number }).status;
  const message = err instanceof Error ? err.message : String(err);
  if (status === 402) return new QuotaError(provider, message);
  if (QUOTA_PATTERNS.some((p) => p.test(message))) return new QuotaError(provider, message);
  return null;
}

function isTransientProviderError(err: unknown): boolean {
  const status = (err as { status?: number }).status;
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (typeof status === "number" && TRANSIENT_STATUS.has(status)) return true;
  return (
    message.includes("unavailable") ||
    message.includes("temporarily") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("try again later") ||
    message.includes("overloaded")
  );
}

// ─── Provider detection ─────────────────────────────────────────────────────────

function getProvider(model: string): Provider {
  if (model.startsWith("gpt-") || model.startsWith("o1") || model.startsWith("o3")) return "openai";
  if (model.startsWith("claude-")) return "anthropic";
  return "gemini";
}

function estimatedInputTokens(req: LlmRequest): number {
  return estimateTokenCount(req.systemPrompt) + estimateUserPartsTokens(req.userParts);
}

// ─── API key helpers ────────────────────────────────────────────────────────────

function getGeminiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");
  return key;
}

function getOpenAIKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set");
  return key;
}

function getAnthropicKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  return key;
}

// ─── Part conversion helpers ────────────────────────────────────────────────────

function toOpenAIParts(
  parts: UserPart[],
): OpenAI.Chat.Completions.ChatCompletionContentPart[] {
  return parts.map((p) => {
    if ("text" in p) return { type: "text" as const, text: p.text };
    return {
      type: "image_url" as const,
      image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` },
    };
  });
}

function toAnthropicParts(
  parts: UserPart[],
): Anthropic.Messages.ContentBlockParam[] {
  return parts.map((p) => {
    if ("text" in p) return { type: "text" as const, text: p.text };
    return {
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: p.inlineData.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
        data: p.inlineData.data,
      },
    };
  });
}

// ─── Non-streaming ──────────────────────────────────────────────────────────────

export async function generateText(req: LlmRequest): Promise<string> {
  const provider = getProvider(req.model);
  for (let attempt = 0; ; attempt++) {
    try {
      switch (provider) {
        case "gemini": {
          const ai = new GoogleGenAI({ apiKey: getGeminiKey() });
          const result = await ai.models.generateContent({
            model: req.model,
            config: {
              systemInstruction: req.systemPrompt,
              thinkingConfig: { thinkingBudget: 0 },
              maxOutputTokens: req.maxOutputTokens,
            },
            contents: [{ role: "user", parts: req.userParts }],
          });
          const text = result.text ?? "";
          const usage = result.usageMetadata;
          recordLlmUsage({
            route: "generateText",
            provider,
            model: req.model,
            inputTokens: usage?.promptTokenCount ?? estimatedInputTokens(req),
            outputTokens: usage?.candidatesTokenCount ?? estimateTokenCount(text),
            exact: Boolean(usage?.totalTokenCount),
          });
          return text;
        }

        case "openai": {
          const client = new OpenAI({ apiKey: getOpenAIKey() });
          const forceJsonObject = req.forceJsonObject ?? false;
          const resp = await client.chat.completions.create({
            model: req.model,
            max_tokens: req.maxOutputTokens,
            ...(forceJsonObject ? { response_format: { type: "json_object" as const } } : {}),
            messages: [
              { role: "system", content: req.systemPrompt },
              { role: "user", content: toOpenAIParts(req.userParts) },
            ],
          });
          const text = resp.choices[0]?.message?.content ?? "";
          recordLlmUsage({
            route: "generateText",
            provider,
            model: req.model,
            inputTokens: resp.usage?.prompt_tokens ?? estimatedInputTokens(req),
            outputTokens: resp.usage?.completion_tokens ?? estimateTokenCount(text),
            exact: Boolean(resp.usage),
          });
          return text;
        }

        case "anthropic": {
          const client = new Anthropic({ apiKey: getAnthropicKey() });
          const resp = await client.messages.create({
            model: req.model,
            max_tokens: req.maxOutputTokens ?? 1024,
            system: req.systemPrompt,
            messages: [{ role: "user", content: toAnthropicParts(req.userParts) }],
          });
          const textBlock = resp.content.find((b) => b.type === "text");
          const text = textBlock?.text ?? "";
          recordLlmUsage({
            route: "generateText",
            provider,
            model: req.model,
            inputTokens: resp.usage.input_tokens ?? estimatedInputTokens(req),
            outputTokens: resp.usage.output_tokens ?? estimateTokenCount(text),
            exact: Boolean(resp.usage),
          });
          return text;
        }
      }
    } catch (err) {
      const quota = toQuotaError(provider, err);
      if (quota) throw quota;
      if (attempt < RETRY_DELAYS_MS.length && isTransientProviderError(err)) {
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      throw err;
    }
  }
}

// ─── Streaming ──────────────────────────────────────────────────────────────────

export async function* generateTextStream(
  req: LlmRequest,
): AsyncGenerator<string> {
  const provider = getProvider(req.model);
  for (let attempt = 0; ; attempt++) {
    let yielded = false;
    try {
      switch (provider) {
        case "gemini": {
          const ai = new GoogleGenAI({ apiKey: getGeminiKey() });
          const stream = await ai.models.generateContentStream({
            model: req.model,
            config: {
              systemInstruction: req.systemPrompt,
              thinkingConfig: { thinkingBudget: 0 },
              maxOutputTokens: req.maxOutputTokens,
            },
            contents: [{ role: "user", parts: req.userParts }],
          });
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
            route: "generateTextStream",
            provider,
            model: req.model,
            inputTokens: promptTokenCount ?? estimatedInputTokens(req),
            outputTokens: candidatesTokenCount ?? estimateTokenCount(accumulated),
            exact: Boolean(totalTokenCount),
          });
          return;
        }

        case "openai": {
          const client = new OpenAI({ apiKey: getOpenAIKey() });
          const forceJsonObject = req.forceJsonObject ?? false;
          const stream = await client.chat.completions.create({
            model: req.model,
            max_tokens: req.maxOutputTokens,
            ...(forceJsonObject ? { response_format: { type: "json_object" as const } } : {}),
            stream: true,
            messages: [
              { role: "system", content: req.systemPrompt },
              { role: "user", content: toOpenAIParts(req.userParts) },
            ],
          });
          let accumulated = "";
          for await (const chunk of stream) {
            const text = chunk.choices[0]?.delta?.content;
            if (text) {
              yielded = true;
              accumulated += text;
              yield text;
            }
          }
          recordLlmUsage({
            route: "generateTextStream",
            provider,
            model: req.model,
            inputTokens: estimatedInputTokens(req),
            outputTokens: estimateTokenCount(accumulated),
            exact: false,
          });
          return;
        }

        case "anthropic": {
          const client = new Anthropic({ apiKey: getAnthropicKey() });
          const stream = client.messages.stream({
            model: req.model,
            max_tokens: req.maxOutputTokens ?? 1024,
            system: req.systemPrompt,
            messages: [{ role: "user", content: toAnthropicParts(req.userParts) }],
          });
          let accumulated = "";
          for await (const event of stream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              yielded = true;
              accumulated += event.delta.text;
              yield event.delta.text;
            }
          }
          recordLlmUsage({
            route: "generateTextStream",
            provider,
            model: req.model,
            inputTokens: estimatedInputTokens(req),
            outputTokens: estimateTokenCount(accumulated),
            exact: false,
          });
          return;
        }
      }
    } catch (err) {
      const quota = toQuotaError(provider, err);
      if (quota) throw quota;
      if (!yielded && attempt < RETRY_DELAYS_MS.length && isTransientProviderError(err)) {
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      throw err;
    }
  }
}
