import { NextRequest, NextResponse } from "next/server";
import { writeFile, unlink, mkdir } from "fs/promises";
import { join } from "path";
import { spawn } from "child_process";
import { VIDEOS_FOLDER } from "@/lib/videoPaths";
import { extensionForMimeType, type VideoExtension } from "@/lib/mediaRecorderSupport";
import { uploadVideoToDrive } from "@/lib/googleDriveUpload";

const MAX_VIDEO_BYTES = 250 * 1024 * 1024;
const FFMPEG_TIMEOUT_MS = 90_000;

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

function convertToMp4(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Targeting universal sharing: iMessage, WhatsApp, Instagram, Android, iOS, Mac, Windows.
    // CRF 22 + 192k AAC = ~10x smaller than the recorder's raw CBR MP4 at
    // perceptually identical quality. yuv420p + main profile + no B-frames +
    // faststart + mp42 brand is the de facto iPhone-style profile every
    // platform accepts (iMessage, WhatsApp, Instagram, Android, QuickTime).
    const proc = spawn("ffmpeg", [
      "-y",
      "-i", inputPath,
      "-r", "30",
      "-c:v", "libx264",
      "-profile:v", "main",
      "-level", "3.1",
      "-bf", "0",
      "-preset", "fast",
      "-crf", "22",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "192k",
      "-ar", "44100",
      "-movflags", "+faststart",
      "-brand", "mp42",
      outputPath,
    ]);

    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, FFMPEG_TIMEOUT_MS);

    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
      } else {
        const msg = timedOut
          ? `ffmpeg timed out after ${FFMPEG_TIMEOUT_MS}ms`
          : `ffmpeg exited ${code}:\n${stderr.slice(-600)}`;
        console.error("[save-video]", msg);
        reject(new Error(msg));
      }
    });
    proc.on("error", (err) => {
      clearTimeout(timeout);
      console.error("[save-video] spawn error:", err);
      reject(err);
    });
  });
}

export async function POST(req: NextRequest) {
  await mkdir(VIDEOS_FOLDER, { recursive: true });

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
  const inputType = req.headers.get("content-type") ?? "video/webm";
  const inputExt: VideoExtension = extensionForMimeType(inputType);
  // Use a `.raw.<ext>` suffix on the input so it never collides with the final
  // `.mp4` output path even when the browser already delivered MP4.
  const inputPath = join(VIDEOS_FOLDER, `${base}.raw.${inputExt}`);
  const mp4Path = join(VIDEOS_FOLDER, `${base}.mp4`);

  await writeFile(inputPath, Buffer.from(arrayBuffer));
  console.log(`[save-video] wrote ${arrayBuffer.byteLength} bytes -> ${inputPath}`);

  try {
    await convertToMp4(inputPath, mp4Path);
    await unlink(inputPath).catch(() => {});
    const { statSync } = await import("fs");
    const finalSize = statSync(mp4Path).size;
    console.log(
      `[save-video] converted -> ${mp4Path} (${arrayBuffer.byteLength} -> ${finalSize} bytes, ${((finalSize / arrayBuffer.byteLength) * 100).toFixed(1)}%)`,
    );

    // Fire-and-forget Drive upload. Don't await — the share UI shouldn't wait on Drive latency.
    void uploadVideoToDrive(mp4Path, `${base}.mp4`)
      .then((result) => {
        if (result) console.log(`[save-video] uploaded to Drive: ${result.webViewLink}`);
      })
      .catch((err) => console.error("[save-video] drive upload threw:", err));

    return NextResponse.json({
      filename: `${base}.mp4`,
      folder: VIDEOS_FOLDER,
      filePath: mp4Path,
      mimeType: "video/mp4",
      sizeBytes: finalSize,
      converted: true,
    });
  } catch (err) {
    // Conversion failed. Salvage by renaming the raw input to the final path
    // so the user still has *something* — but only if the input was already
    // an MP4 (universal playback). WebM gets returned as-is and the share UI
    // can flag the format.
    const fallbackPath = join(VIDEOS_FOLDER, `${base}.${inputExt}`);
    try {
      const { rename } = await import("fs/promises");
      await rename(inputPath, fallbackPath);
    } catch {
      /* rename failed, leave the .raw. file in place */
    }
    return NextResponse.json(
      {
        filename: `${base}.${inputExt}`,
        folder: VIDEOS_FOLDER,
        filePath: fallbackPath,
        mimeType: inputType,
        sizeBytes: arrayBuffer.byteLength,
        conversionError: String(err),
      },
      { status: 200 },
    );
  }
}
