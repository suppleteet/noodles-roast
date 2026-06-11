import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, rename } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

const DEBUG_DIR = path.join(process.cwd(), ".debug");
const MAX_BODY_BYTES = 1_000_000; // 1MB

export async function POST(req: NextRequest) {
  try {
    const rawText = await req.text();
    if (rawText.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }

    const body = JSON.parse(rawText) as {
      timingLog?: string[];
      transcriptHistory?: { role: string; text: string; ts: number }[];
      sessionStartTs?: number | null;
      trigger?: string;
      laughCount?: number;
      smileFrames?: number;
      totalVisionFrames?: number;
      timeToFirstSpeechMs?: number | null;
      activePersona?: string;
      burnIntensity?: number;
      videoFilename?: string | null;
    };

    await mkdir(DEBUG_DIR, { recursive: true });

    const totalFrames = body.totalVisionFrames ?? 0;
    const smilePct = totalFrames > 0
      ? Math.round(((body.smileFrames ?? 0) / totalFrames) * 100)
      : null;

    const content = JSON.stringify({
      savedAt: new Date().toISOString(),
      trigger: body.trigger ?? "unknown",
      sessionStartTs: body.sessionStartTs,
      laughCount: body.laughCount ?? 0,
      smilePercent: smilePct,
      smileFrames: body.smileFrames ?? 0,
      totalVisionFrames: totalFrames,
      timeToFirstSpeechMs: body.timeToFirstSpeechMs ?? null,
      activePersona: body.activePersona ?? null,
      burnIntensity: body.burnIntensity ?? null,
      videoFilename: body.videoFilename ?? null,
      timingLog: body.timingLog ?? [],
      transcriptHistory: body.transcriptHistory ?? [],
    }, null, 2);

    // Atomic write: session end can fire two saves nearly simultaneously
    // (end-trigger + beforeunload), and two concurrent writeFile calls to the
    // same path interleave — a real log came out as new JSON with a stale tail
    // of the previous longer write appended. Write to a unique temp file, then
    // rename over the target (replace-existing is atomic per volume).
    const target = path.join(DEBUG_DIR, "last-session.json");
    const tmp = path.join(DEBUG_DIR, `.last-session.${randomUUID()}.tmp`);
    await writeFile(tmp, content, "utf-8");
    await rename(tmp, target);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[save-log]", err);
    return NextResponse.json({ error: "Failed to save log" }, { status: 500 });
  }
}
