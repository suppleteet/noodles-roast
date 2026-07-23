export const ROAST_MODEL_IDS = [
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-2.5-flash",
  // Legacy choices remain valid so persisted dev selections still load.
  "gemini-3.1-flash-lite",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.4-mini",
  "gpt-4o",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
] as const;

export type RoastModelId = (typeof ROAST_MODEL_IDS)[number];

const ROAST_MODEL_ID_SET: ReadonlySet<string> = new Set(ROAST_MODEL_IDS);

export function isRoastModelId(value: unknown): value is RoastModelId {
  return typeof value === "string" && ROAST_MODEL_ID_SET.has(value);
}
