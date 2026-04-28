import { NextRequest, NextResponse } from "next/server";
import {
  attachSquareCheckout,
  createPendingCheckout,
  ensureBuyer,
} from "@/lib/entitlementLedger";
import { getBuyerIdFromRequest, setBuyerCookie } from "@/lib/monetizationCookies";
import { findRoastPassProduct, paymentsEnabled } from "@/lib/monetizationCatalog";
import { createSquareCheckoutLink, getSquareConfig } from "@/lib/squareCheckout";

export async function POST(req: NextRequest) {
  if (!paymentsEnabled()) {
    return NextResponse.json({ error: "Payments are disabled" }, { status: 403 });
  }
  if (!getSquareConfig()) {
    return NextResponse.json(
      { error: "Square is not configured. Set SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID." },
      { status: 503 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { sku?: string };
  const product = findRoastPassProduct(body.sku ?? "");
  if (!product) {
    return NextResponse.json({ error: "Unknown roast pass" }, { status: 400 });
  }

  const buyerId = getBuyerIdFromRequest(req);
  await ensureBuyer(buyerId);
  const checkout = await createPendingCheckout({
    buyerId,
    sku: product.sku,
    credits: product.credits,
    amountCents: product.amountCents,
    currency: product.currency,
  });

  const redirectUrl = `${req.nextUrl.origin}/?checkout=success`;
  const squareCheckout = await createSquareCheckoutLink({
    checkout,
    product,
    redirectUrl,
  });
  const updated = await attachSquareCheckout({
    checkoutId: checkout.id,
    paymentLinkId: squareCheckout.paymentLinkId,
    orderId: squareCheckout.orderId,
    checkoutUrl: squareCheckout.url,
  });

  const res = NextResponse.json({
    checkoutId: checkout.id,
    orderId: squareCheckout.orderId,
    url: squareCheckout.url,
    checkout: updated,
  });
  setBuyerCookie(res, buyerId);
  return res;
}
