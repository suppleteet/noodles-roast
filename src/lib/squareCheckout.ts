import { createHmac, timingSafeEqual } from "crypto";
import type { PendingCheckout } from "@/lib/entitlementLedger";
import type { RoastPassProduct } from "@/lib/monetizationCatalog";

export const SQUARE_API_VERSION = "2026-01-22";

interface SquareMoney {
  amount: number;
  currency: "USD";
}

interface SquarePayment {
  id: string;
  status: string;
  order_id?: string;
  amount_money?: SquareMoney;
  total_money?: SquareMoney;
}

interface SquareCreatePaymentLinkResponse {
  payment_link?: {
    id?: string;
    order_id?: string;
    url?: string;
    long_url?: string;
  };
  errors?: { code?: string; detail?: string }[];
}

interface SquareListPaymentsResponse {
  payments?: SquarePayment[];
  errors?: { code?: string; detail?: string }[];
}

interface SquareConfig {
  accessToken: string;
  locationId: string;
  apiBase: string;
}

function squareApiBase(): string {
  return process.env.SQUARE_ENVIRONMENT === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";
}

export function getSquareConfig(): SquareConfig | null {
  const accessToken = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.SQUARE_LOCATION_ID;
  if (!accessToken || !locationId) return null;
  return {
    accessToken,
    locationId,
    apiBase: squareApiBase(),
  };
}

function squareHeaders(config: SquareConfig): HeadersInit {
  return {
    "Authorization": `Bearer ${config.accessToken}`,
    "Content-Type": "application/json",
    "Square-Version": SQUARE_API_VERSION,
  };
}

function squareErrorMessage(errors: SquareCreatePaymentLinkResponse["errors"]): string {
  if (!errors?.length) return "Square request failed";
  return errors.map((error) => error.detail ?? error.code ?? "Square error").join("; ");
}

export async function createSquareCheckoutLink(input: {
  checkout: PendingCheckout;
  product: RoastPassProduct;
  redirectUrl: string;
}): Promise<{ paymentLinkId: string; orderId: string; url: string }> {
  const config = getSquareConfig();
  if (!config) {
    throw new Error("Square is not configured. Set SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID.");
  }

  const body = {
    idempotency_key: input.checkout.id,
    description: `${input.product.name} for Roastie`,
    order: {
      location_id: config.locationId,
      reference_id: input.checkout.id,
      source: { name: "Roastie" },
      line_items: [
        {
          name: input.product.name,
          quantity: "1",
          item_type: "ITEM",
          base_price_money: {
            amount: input.product.amountCents,
            currency: input.product.currency,
          },
        },
      ],
      fulfillments: [
        {
          type: "DIGITAL",
          state: "PROPOSED",
        },
      ],
    },
    checkout_options: {
      redirect_url: input.redirectUrl,
      enable_coupon: false,
    },
    payment_note: `Roastie ${input.product.sku} ${input.checkout.id}`,
  };

  const resp = await fetch(`${config.apiBase}/v2/online-checkout/payment-links`, {
    method: "POST",
    headers: squareHeaders(config),
    body: JSON.stringify(body),
  });
  const data = (await resp.json().catch(() => ({}))) as SquareCreatePaymentLinkResponse;

  if (!resp.ok) {
    throw new Error(squareErrorMessage(data.errors));
  }

  const paymentLink = data.payment_link;
  if (!paymentLink?.id || !paymentLink.order_id || !paymentLink.url) {
    throw new Error("Square did not return a usable payment link.");
  }

  return {
    paymentLinkId: paymentLink.id,
    orderId: paymentLink.order_id,
    url: paymentLink.url,
  };
}

export async function findCompletedPaymentForOrder(input: {
  orderId: string;
  amountCents: number;
  createdAt: string;
}): Promise<SquarePayment | null> {
  const config = getSquareConfig();
  if (!config) return null;

  const begin = new Date(input.createdAt);
  begin.setMinutes(begin.getMinutes() - 5);
  const params = new URLSearchParams({
    begin_time: begin.toISOString(),
    location_id: config.locationId,
    sort_order: "DESC",
    limit: "100",
  });

  const resp = await fetch(`${config.apiBase}/v2/payments?${params.toString()}`, {
    headers: squareHeaders(config),
  });
  const data = (await resp.json().catch(() => ({}))) as SquareListPaymentsResponse;
  if (!resp.ok || data.errors?.length) return null;

  return (
    data.payments?.find((payment) => {
      const amount = payment.total_money?.amount ?? payment.amount_money?.amount;
      return (
        payment.order_id === input.orderId &&
        payment.status === "COMPLETED" &&
        amount === input.amountCents
      );
    }) ?? null
  );
}

export function verifySquareWebhookSignature(input: {
  signature: string | null;
  body: string;
  notificationUrl: string;
  signatureKey: string;
}): boolean {
  if (!input.signature || !input.signatureKey || !input.notificationUrl) return false;
  const expected = createHmac("sha256", input.signatureKey)
    .update(input.notificationUrl + input.body)
    .digest("base64");

  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(input.signature);
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}
