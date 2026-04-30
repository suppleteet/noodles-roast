import { NextRequest, NextResponse } from "next/server";
import { ensureBuyer, getBuyerStatus } from "@/lib/entitlementLedger";
import { getBuyerIdFromRequest, setBuyerCookie } from "@/lib/monetizationCookies";
import { paymentsEnabled, ROAST_PASS_PRODUCTS } from "@/lib/monetizationCatalog";
import { syncPendingSquarePaymentsForBuyer } from "@/lib/monetizationSync";
import { getSquareConfig } from "@/lib/squareCheckout";

export async function GET(req: NextRequest) {
  const buyerId = getBuyerIdFromRequest(req);
  await ensureBuyer(buyerId);

  if (paymentsEnabled() && getSquareConfig()) {
    await syncPendingSquarePaymentsForBuyer(buyerId);
  }

  const status = await getBuyerStatus(buyerId);
  const res = NextResponse.json({
    enabled: paymentsEnabled(),
    configured: Boolean(getSquareConfig()),
    products: ROAST_PASS_PRODUCTS,
    ...status,
  });
  setBuyerCookie(res, buyerId);
  return res;
}
