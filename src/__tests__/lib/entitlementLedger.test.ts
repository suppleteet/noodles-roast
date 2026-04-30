import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  attachSquareCheckout,
  consumeRoastCredit,
  createPendingCheckout,
  ensureBuyer,
  getBuyerStatus,
  markCheckoutPaidByOrderId,
} from "@/lib/entitlementLedger";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "roastie-ledger-"));
  process.env.ROASTIE_LEDGER_PATH = join(tempDir, "ledger.json");
});

afterEach(async () => {
  delete process.env.ROASTIE_LEDGER_PATH;
  await rm(tempDir, { recursive: true, force: true });
});

describe("entitlementLedger", () => {
  it("grants credits once when a checkout is marked paid", async () => {
    await ensureBuyer("buyer_test");
    const checkout = await createPendingCheckout({
      buyerId: "buyer_test",
      sku: "party-pack",
      credits: 6,
      amountCents: 1999,
      currency: "USD",
    });
    await attachSquareCheckout({
      checkoutId: checkout.id,
      paymentLinkId: "plink",
      orderId: "order_123",
      checkoutUrl: "https://square.link/u/test",
    });

    await markCheckoutPaidByOrderId("order_123");
    await markCheckoutPaidByOrderId("order_123");

    const status = await getBuyerStatus("buyer_test");
    expect(status.credits).toBe(6);
    expect(status.totalPurchasedCredits).toBe(6);
    expect(status.totalSpentCents).toBe(1999);
  });

  it("consumes exactly one credit", async () => {
    await ensureBuyer("buyer_test");
    const checkout = await createPendingCheckout({
      buyerId: "buyer_test",
      sku: "solo-roast",
      credits: 1,
      amountCents: 499,
      currency: "USD",
    });
    await attachSquareCheckout({
      checkoutId: checkout.id,
      paymentLinkId: "plink",
      orderId: "order_123",
      checkoutUrl: "https://square.link/u/test",
    });
    await markCheckoutPaidByOrderId("order_123");

    expect((await consumeRoastCredit("buyer_test"))?.credits).toBe(0);
    expect(await consumeRoastCredit("buyer_test")).toBeNull();
  });
});
