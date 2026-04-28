import { describe, expect, it } from "vitest";
import {
  findRoastPassProduct,
  formatUsd,
  ROAST_PASS_PRODUCTS,
} from "@/lib/monetizationCatalog";

describe("monetizationCatalog", () => {
  it("offers one-time products only", () => {
    expect(ROAST_PASS_PRODUCTS.length).toBeGreaterThanOrEqual(3);
    expect(ROAST_PASS_PRODUCTS.every((product) => product.credits > 0)).toBe(true);
    expect(ROAST_PASS_PRODUCTS.every((product) => product.amountCents > 0)).toBe(true);
  });

  it("finds products by sku", () => {
    expect(findRoastPassProduct("party-pack")?.credits).toBe(6);
    expect(findRoastPassProduct("missing")).toBeNull();
  });

  it("formats USD prices", () => {
    expect(formatUsd(499)).toBe("$4.99");
  });
});
