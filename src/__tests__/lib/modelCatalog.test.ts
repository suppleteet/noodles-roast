import { describe, expect, it } from "vitest";
import { isRoastModelId, ROAST_MODEL_IDS } from "@/lib/modelCatalog";

describe("model catalog", () => {
  it("contains every selectable balanced model", () => {
    expect(ROAST_MODEL_IDS).toContain("gemini-3.6-flash");
    expect(ROAST_MODEL_IDS).toContain("gpt-5.6-terra");
    expect(ROAST_MODEL_IDS).toContain("claude-sonnet-4-6");
  });

  it("rejects arbitrary provider model IDs", () => {
    expect(isRoastModelId("gpt-5.6-sol")).toBe(false);
    expect(isRoastModelId("../../expensive-model")).toBe(false);
  });
});
