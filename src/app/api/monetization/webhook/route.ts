import { NextRequest, NextResponse } from "next/server";
import {
  markCheckoutPaidByOrderId,
  markWebhookEventProcessed,
} from "@/lib/entitlementLedger";
import { verifySquareWebhookSignature } from "@/lib/squareCheckout";

interface SquareWebhookBody {
  event_id?: string;
  type?: string;
  data?: {
    object?: {
      payment?: {
        order_id?: string;
        status?: string;
      };
    };
  };
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  const notificationUrl =
    process.env.SQUARE_WEBHOOK_NOTIFICATION_URL ?? `${req.nextUrl.origin}${req.nextUrl.pathname}`;

  if (signatureKey) {
    const valid = verifySquareWebhookSignature({
      signature: req.headers.get("x-square-hmacsha256-signature"),
      body: rawBody,
      notificationUrl,
      signatureKey,
    });
    if (!valid) return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  let body: SquareWebhookBody;
  try {
    body = JSON.parse(rawBody) as SquareWebhookBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (body.event_id) {
    const firstSeen = await markWebhookEventProcessed(body.event_id);
    if (!firstSeen) return NextResponse.json({ ok: true, duplicate: true });
  }

  const payment = body.data?.object?.payment;
  if (payment?.status === "COMPLETED" && payment.order_id) {
    await markCheckoutPaidByOrderId(payment.order_id);
  }

  return NextResponse.json({ ok: true });
}
