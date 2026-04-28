import { NextRequest, NextResponse } from "next/server";
import { createBuyerId } from "@/lib/entitlementLedger";

const BUYER_COOKIE = "roastie_buyer_id";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function getBuyerIdFromRequest(req: NextRequest): string {
  const existing = req.cookies.get(BUYER_COOKIE)?.value;
  if (existing?.startsWith("buyer_")) return existing;
  return createBuyerId();
}

export function setBuyerCookie(res: NextResponse, buyerId: string): void {
  res.cookies.set(BUYER_COOKIE, buyerId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
  });
}
