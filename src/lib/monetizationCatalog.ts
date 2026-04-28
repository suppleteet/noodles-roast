export type RoastPassSku = "solo-roast" | "party-pack" | "event-pack";

export interface RoastPassProduct {
  sku: RoastPassSku;
  name: string;
  description: string;
  credits: number;
  amountCents: number;
  currency: "USD";
  featured?: boolean;
}

export const ROAST_PASS_PRODUCTS: readonly RoastPassProduct[] = [
  {
    sku: "solo-roast",
    name: "Roast Pass",
    description: "One live roast session with recording export.",
    credits: 1,
    amountCents: 499,
    currency: "USD",
  },
  {
    sku: "party-pack",
    name: "Party Pack",
    description: "Six roasts for parties, streams, and repeat victims.",
    credits: 6,
    amountCents: 1999,
    currency: "USD",
    featured: true,
  },
  {
    sku: "event-pack",
    name: "Event Pack",
    description: "Forty roasts for booths, bars, and live activations.",
    credits: 40,
    amountCents: 9900,
    currency: "USD",
  },
];

export function paymentsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ROASTIE_PAYMENTS_ENABLED === "true";
}

export function findRoastPassProduct(sku: string): RoastPassProduct | null {
  return ROAST_PASS_PRODUCTS.find((product) => product.sku === sku) ?? null;
}

export function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}
