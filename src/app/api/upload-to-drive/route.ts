import { NextRequest, NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { isSafeVideoFilename } from "@/lib/mediaRecorderSupport";
import { uploadRemoteVideoToDrive } from "@/lib/googleDriveUpload";

/**
 * Triggered by the "Send to Tyler" button. By the time we're called the client
 * has already streamed the recording to Vercel Blob (see /api/video-blob-upload)
 * and hands us the durable Blob URL. We copy that into Drive, then delete the
 * temporary Blob copy.
 *
 * This replaced the old read-from-/tmp flow, which only worked on a single
 * persistent dev process: on Vercel the file written by /api/save-video lived
 * in one serverless instance's ephemeral /tmp and was gone by the time this
 * route ran on a different instance ("File not found on server").
 */
export async function POST(req: NextRequest) {
  const { blobUrl, filename } = (await req.json().catch(() => ({}))) as {
    blobUrl?: string;
    filename?: string;
  };

  if (!isSafeVideoFilename(filename)) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }
  if (!blobUrl) {
    return NextResponse.json({ error: "Missing blobUrl" }, { status: 400 });
  }

  // Only accept Vercel Blob URLs — prevents this route from being used as an
  // SSRF proxy to fetch arbitrary internal URLs.
  let host: string;
  try {
    host = new URL(blobUrl).host;
  } catch {
    return NextResponse.json({ error: "Invalid blobUrl" }, { status: 400 });
  }
  if (!host.endsWith(".blob.vercel-storage.com")) {
    return NextResponse.json({ error: "Invalid blobUrl host" }, { status: 400 });
  }

  try {
    const result = await uploadRemoteVideoToDrive(blobUrl, filename);
    if (!result) {
      return NextResponse.json(
        { error: "Drive credentials not configured" },
        { status: 503 },
      );
    }
    // Best-effort cleanup — the recording is safely in Drive now, so drop the
    // temporary Blob copy. Don't fail the request if cleanup hiccups.
    await del(blobUrl).catch((e) =>
      console.warn("[upload-to-drive] blob cleanup failed:", e),
    );
    return NextResponse.json({ webViewLink: result.webViewLink, fileId: result.fileId });
  } catch (err) {
    console.warn("[upload-to-drive] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 500 },
    );
  }
}
