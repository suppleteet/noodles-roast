import { NextResponse } from "next/server";
import { getLlmUsageSnapshot } from "@/lib/usageTracker";

export async function GET() {
  return NextResponse.json(getLlmUsageSnapshot());
}
