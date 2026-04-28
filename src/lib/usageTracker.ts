export type LlmProvider = "gemini" | "openai" | "anthropic";

export interface LlmUsageEntry {
  id: string;
  ts: number;
  route: string;
  provider: LlmProvider;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  exact: boolean;
}

export interface LlmUsageSnapshot {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  recent: LlmUsageEntry[];
}

const usageEntries: LlmUsageEntry[] = [];

const MODEL_PRICE_PER_MILLION: Record<string, { input: number; output: number }> = {
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gpt-4o": { input: 2.5, output: 10 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
};

function priceForModel(model: string): { input: number; output: number } {
  if (MODEL_PRICE_PER_MILLION[model]) return MODEL_PRICE_PER_MILLION[model];
  if (model.startsWith("gpt-")) return { input: 2.5, output: 10 };
  if (model.startsWith("claude-haiku")) return { input: 1, output: 5 };
  if (model.startsWith("claude-")) return { input: 3, output: 15 };
  return { input: 0.3, output: 2.5 };
}

export function estimateTokenCount(text: string): number {
  if (!text.trim()) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateUserPartsTokens(parts: Array<{ text?: string; inlineData?: unknown }>): number {
  return parts.reduce((sum, part) => {
    if (typeof part.text === "string") return sum + estimateTokenCount(part.text);
    // A 512px JPEG vision prompt is provider-dependent; this keeps debug costs directionally useful.
    return sum + 260;
  }, 0);
}

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = priceForModel(model);
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

export function recordLlmUsage(input: {
  route: string;
  provider: LlmProvider;
  model: string;
  inputTokens: number;
  outputTokens: number;
  exact: boolean;
}): LlmUsageEntry {
  const inputTokens = Math.max(0, Math.round(input.inputTokens));
  const outputTokens = Math.max(0, Math.round(input.outputTokens));
  const entry: LlmUsageEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: Date.now(),
    route: input.route,
    provider: input.provider,
    model: input.model,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCostUsd: estimateCostUsd(input.model, inputTokens, outputTokens),
    exact: input.exact,
  };
  usageEntries.push(entry);
  usageEntries.splice(0, Math.max(0, usageEntries.length - 250));
  return entry;
}

export function getLlmUsageSnapshot(): LlmUsageSnapshot {
  const totals = usageEntries.reduce(
    (acc, entry) => ({
      calls: acc.calls + 1,
      inputTokens: acc.inputTokens + entry.inputTokens,
      outputTokens: acc.outputTokens + entry.outputTokens,
      totalTokens: acc.totalTokens + entry.totalTokens,
      estimatedCostUsd: acc.estimatedCostUsd + entry.estimatedCostUsd,
    }),
    { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 },
  );
  return {
    ...totals,
    recent: usageEntries.slice(-10).reverse(),
  };
}

export function resetLlmUsageForTests(): void {
  usageEntries.length = 0;
}
