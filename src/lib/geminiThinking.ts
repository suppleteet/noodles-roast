import { ThinkingLevel, type ThinkingConfig } from "@google/genai";

export type GeminiWorkload = "creative" | "comedy-deliberate" | "realtime-utility";

/**
 * Gemini 3.x replaced numeric thinking budgets with thinking levels. Creative
 * joke generation gets a small reasoning allowance for quality; vision/STT
 * utility calls stay minimal so they do not add avoidable turn latency.
 *
 * Gemini 2.x still uses the legacy token budget, so keep its explicit
 * zero-thinking configuration for backward-compatible fallback models.
 */
export function geminiThinkingConfig(
  model: string,
  workload: GeminiWorkload,
): ThinkingConfig {
  if (model.startsWith("gemini-3")) {
    return {
      thinkingLevel:
        workload === "comedy-deliberate"
          ? ThinkingLevel.MEDIUM
          : workload === "creative"
            ? ThinkingLevel.LOW
            : ThinkingLevel.MINIMAL,
    };
  }

  return { thinkingBudget: 0 };
}
