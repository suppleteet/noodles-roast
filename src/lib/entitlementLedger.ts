import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { randomUUID } from "crypto";
import type { RoastPassSku } from "@/lib/monetizationCatalog";

export type CheckoutStatus = "pending" | "paid" | "consumed" | "expired";

export interface LedgerBuyer {
  buyerId: string;
  credits: number;
  totalPurchasedCredits: number;
  totalSpentCents: number;
  createdAt: string;
  updatedAt: string;
}

export interface PendingCheckout {
  id: string;
  buyerId: string;
  sku: RoastPassSku;
  credits: number;
  amountCents: number;
  currency: "USD";
  status: CheckoutStatus;
  paymentLinkId: string | null;
  orderId: string | null;
  checkoutUrl: string | null;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  consumedAt: string | null;
}

export interface MonetizationLedger {
  buyers: Record<string, LedgerBuyer>;
  checkouts: Record<string, PendingCheckout>;
  processedWebhookEvents: Record<string, string>;
}

export interface BuyerEntitlementStatus {
  buyerId: string;
  credits: number;
  totalPurchasedCredits: number;
  totalSpentCents: number;
  pending: PendingCheckout[];
}

const EMPTY_LEDGER: MonetizationLedger = {
  buyers: {},
  checkouts: {},
  processedWebhookEvents: {},
};

let mutationQueue: Promise<void> = Promise.resolve();

function ledgerPath(): string {
  return process.env.ROASTIE_LEDGER_PATH ?? join(process.cwd(), ".data", "monetization-ledger.json");
}

function nowIso(): string {
  return new Date().toISOString();
}

function cloneEmptyLedger(): MonetizationLedger {
  return {
    buyers: {},
    checkouts: {},
    processedWebhookEvents: {},
  };
}

async function readLedger(): Promise<MonetizationLedger> {
  try {
    const raw = await readFile(ledgerPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<MonetizationLedger>;
    return {
      buyers: parsed.buyers ?? {},
      checkouts: parsed.checkouts ?? {},
      processedWebhookEvents: parsed.processedWebhookEvents ?? {},
    };
  } catch {
    return cloneEmptyLedger();
  }
}

async function writeLedger(ledger: MonetizationLedger): Promise<void> {
  const path = ledgerPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(ledger, null, 2));
}

async function mutateLedger<T>(fn: (ledger: MonetizationLedger) => T): Promise<T> {
  const run = mutationQueue.then(async () => {
    const ledger = await readLedger();
    const result = fn(ledger);
    await writeLedger(ledger);
    return result;
  });
  mutationQueue = run.then(() => {}, () => {});
  return run;
}

export function createBuyerId(): string {
  return `buyer_${randomUUID()}`;
}

export async function ensureBuyer(buyerId: string): Promise<LedgerBuyer> {
  return mutateLedger((ledger) => {
    const existing = ledger.buyers[buyerId];
    if (existing) return existing;
    const ts = nowIso();
    const buyer: LedgerBuyer = {
      buyerId,
      credits: 0,
      totalPurchasedCredits: 0,
      totalSpentCents: 0,
      createdAt: ts,
      updatedAt: ts,
    };
    ledger.buyers[buyerId] = buyer;
    return buyer;
  });
}

export async function createPendingCheckout(input: {
  buyerId: string;
  sku: RoastPassSku;
  credits: number;
  amountCents: number;
  currency: "USD";
}): Promise<PendingCheckout> {
  return mutateLedger((ledger) => {
    const ts = nowIso();
    if (!ledger.buyers[input.buyerId]) {
      ledger.buyers[input.buyerId] = {
        buyerId: input.buyerId,
        credits: 0,
        totalPurchasedCredits: 0,
        totalSpentCents: 0,
        createdAt: ts,
        updatedAt: ts,
      };
    }
    const checkout: PendingCheckout = {
      id: `checkout_${randomUUID()}`,
      buyerId: input.buyerId,
      sku: input.sku,
      credits: input.credits,
      amountCents: input.amountCents,
      currency: input.currency,
      status: "pending",
      paymentLinkId: null,
      orderId: null,
      checkoutUrl: null,
      createdAt: ts,
      updatedAt: ts,
      paidAt: null,
      consumedAt: null,
    };
    ledger.checkouts[checkout.id] = checkout;
    return checkout;
  });
}

export async function attachSquareCheckout(input: {
  checkoutId: string;
  paymentLinkId: string;
  orderId: string;
  checkoutUrl: string;
}): Promise<PendingCheckout | null> {
  return mutateLedger((ledger) => {
    const checkout = ledger.checkouts[input.checkoutId];
    if (!checkout) return null;
    checkout.paymentLinkId = input.paymentLinkId;
    checkout.orderId = input.orderId;
    checkout.checkoutUrl = input.checkoutUrl;
    checkout.updatedAt = nowIso();
    return checkout;
  });
}

export async function markCheckoutPaidByOrderId(orderId: string): Promise<PendingCheckout | null> {
  return mutateLedger((ledger) => {
    const checkout = Object.values(ledger.checkouts).find((item) => item.orderId === orderId);
    if (!checkout) return null;
    if (checkout.status === "paid" || checkout.status === "consumed") return checkout;

    const buyer = ledger.buyers[checkout.buyerId];
    if (!buyer) return null;
    const ts = nowIso();
    checkout.status = "paid";
    checkout.paidAt = ts;
    checkout.updatedAt = ts;
    buyer.credits += checkout.credits;
    buyer.totalPurchasedCredits += checkout.credits;
    buyer.totalSpentCents += checkout.amountCents;
    buyer.updatedAt = ts;
    return checkout;
  });
}

export async function markWebhookEventProcessed(eventId: string): Promise<boolean> {
  return mutateLedger((ledger) => {
    if (ledger.processedWebhookEvents[eventId]) return false;
    ledger.processedWebhookEvents[eventId] = nowIso();
    return true;
  });
}

export async function getBuyerStatus(buyerId: string): Promise<BuyerEntitlementStatus> {
  const ledger = await readLedger();
  const buyer = ledger.buyers[buyerId] ?? {
    buyerId,
    credits: 0,
    totalPurchasedCredits: 0,
    totalSpentCents: 0,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  return {
    buyerId,
    credits: buyer.credits,
    totalPurchasedCredits: buyer.totalPurchasedCredits,
    totalSpentCents: buyer.totalSpentCents,
    pending: Object.values(ledger.checkouts)
      .filter((checkout) => checkout.buyerId === buyerId && checkout.status === "pending")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}

export async function getPendingCheckoutsForBuyer(buyerId: string): Promise<PendingCheckout[]> {
  const ledger = await readLedger();
  return Object.values(ledger.checkouts).filter(
    (checkout) => checkout.buyerId === buyerId && checkout.status === "pending",
  );
}

export async function consumeRoastCredit(buyerId: string): Promise<BuyerEntitlementStatus | null> {
  return mutateLedger((ledger) => {
    const buyer = ledger.buyers[buyerId];
    if (!buyer || buyer.credits <= 0) return null;
    const ts = nowIso();
    buyer.credits -= 1;
    buyer.updatedAt = ts;
    return {
      buyerId,
      credits: buyer.credits,
      totalPurchasedCredits: buyer.totalPurchasedCredits,
      totalSpentCents: buyer.totalSpentCents,
      pending: Object.values(ledger.checkouts)
        .filter((checkout) => checkout.buyerId === buyerId && checkout.status === "pending")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    };
  });
}

export { EMPTY_LEDGER };
