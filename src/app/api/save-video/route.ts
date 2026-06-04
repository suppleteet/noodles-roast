import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { VIDEOS_FOLDER } from "@/lib/videoPaths";

const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

const ADJECTIVES = [
  "charred", "scorched", "roasted", "singed", "crispy",
  "flaming", "toasted", "smoked", "sizzled", "burnt",
  "demolished", "obliterated", "eviscerated", "destroyed", "wrecked",
];
const NOUNS = [
  "noodle", "comedian", "victim", "survivor", "legend",
  "wreck", "disaster", "tragedy", "clown", "hero",
  "bystander", "casualty", "masterpiece", "disaster-zone", "relic",
];

function cleverBaseName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const ts = new Date()
    .toISOString()
    .replace("T", "-")
    .replace(/:/g, "")
    .slice(0, 17); // "2026-03-24-142301"
  return `${adj}-${noun}-${ts}`;
}

/** Accept only safe file-base characters so a client-supplied name can't path-traverse. */
function sanitizeRequestedName(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
  if (cleaned.length < 3) return null;
  return cleaned;
}

function isMp4ContentType(ct: string): boolean {
  return ct.toLowerCase().includes("mp4");
}

export async function POST(req: NextRequest) {
  await mkdir(VIDEOS_FOLDER, { recursive: true });

  const inputType = req.headers.get("content-type") ?? "";
  // MP4-only: the client gates recording on MediaRecorder MP4 support before
  // a session even starts, so by the time we get here the body should always
  // be MP4. Reject anything else explicitly rather than letting WebM files
  // accumulate on disk we can't convert (no ffmpeg on Vercel Hobby tier).
  if (!isMp4ContentType(inputType)) {
    return NextResponse.json(
      {
        error: "MP4 required",
        detail: `Got content-type "${inputType}". This browser's MediaRecorder didn't produce MP4 — recording should have been blocked client-side. Try Chrome (desktop or Android), Safari, or Edge.`,
      },
      { status: 415 },
    );
  }

  const arrayBuffer = await req.arrayBuffer();
  if (arrayBuffer.byteLength === 0) {
    return NextResponse.json({ error: "Empty blob" }, { status: 400 });
  }
  if (arrayBuffer.byteLength > MAX_VIDEO_BYTES) {
    return NextResponse.json({ error: "Video too large" }, { status: 413 });
  }

  // Caller can pass a pre-generated name via ?name=... (from /api/name-video). The
  // sanitizer enforces [A-Za-z0-9_-] only so a hostile string can't escape the videos
  // folder. Falls back to the random adjective-noun-timestamp name on empty/short input.
  const requestedName = sanitizeRequestedName(req.nextUrl.searchParams.get("name"));
  const base = requestedName ?? cleverBaseName();
  const filename = `${base}.mp4`;
  const filePath = join(VIDEOS_FOLDER, filename);

  await writeFile(filePath, Buffer.from(arrayBuffer));
  console.log(`[save-video] wrote ${arrayBuffer.byteLength} bytes -> ${filePath}`);

  // No conversion + no fire-and-forget Drive upload. /api/upload-to-drive
  // handles the Drive transfer when the user clicks "Send to Tyler".

  return NextResponse.json({
    filename,
    folder: VIDEOS_FOLDER,
    filePath,
    mimeType: "video/mp4",
    sizeBytes: arrayBuffer.byteLength,
  });
}
