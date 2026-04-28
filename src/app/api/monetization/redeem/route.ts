import { NextRequest, NextResponse } from "next/server";
import { consumeRoastCredit, ensureBuyer } from "@/lib/entitlementLedger";
import { getBuyerIdFromRequest, setBuyerCookie } from "@/lib/monetizationCookies";
import { paymentsEnabled } from "@/lib/monetizationCatalog";

export async function POST(req: NextRequest) {
  const buyerId = getBuyerIdFromRequest(req);
  await ensureBuyer(buyerId);

  if (!paymentsEnabled()) {
    const res = NextResponse.json({ ok: true, enabled: false });
    setBuyerCookie(res, buyerId);
    return res;
  }

  const status = await consumeRoastCredit(buyerId);
  if (!status) {
    const res = NextResponse.json(
      { ok: false, enabled: true, error: "No roast credits available" },
      { status: 402 },
    );
    setBuyerCookie(res, buyerId);
    return res;
  }

  const res = NextResponse.json({ ok: true, enabled: true, ...status });
  setBuyerCookie(res, buyerId);
  return res;
}
