import { createHmac } from "crypto";
import { describe, expect, it } from "vitest";
import { verifySquareWebhookSignature } from "@/lib/squareCheckout";

describe("squareCheckout", () => {
  it("verifies Square webhook signatures with constant-time comparison", () => {
    const body = JSON.stringify({ hello: "world" });
    const notificationUrl = "https://example.com/api/monetization/webhook";
    const signatureKey = "test_signature_key";
    const signature = createHmac("sha256", signatureKey)
      .update(notificationUrl + body)
      .digest("base64");

    expect(verifySquareWebhookSignature({
      signature,
      body,
      notificationUrl,
      signatureKey,
    })).toBe(true);
    expect(verifySquareWebhookSignature({
      signature: `${signature.slice(0, -2)}xx`,
      body,
      notificationUrl,
      signatureKey,
    })).toBe(false);
  });
});
