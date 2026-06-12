import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextRequest, NextResponse } from "next/server";

/**
 * Mints short-lived client-upload tokens so the browser can stream the
 * recorded MP4 straight to Vercel Blob — bypassing the ~4.5 MB serverless
 * request-body cap that made the old "POST the video to /api/save-video"
 * flow fail on Vercel for anything but the shortest sessions.
 *
 * Flow: ShareScreen calls `upload()` (from `@vercel/blob/client`) pointing at
 * this route; we hand back a scoped token; the blob lands in Vercel Blob; the
 * client then asks /api/upload-to-drive to copy that durable Blob URL into
 * Drive. Nothing touches the (per-invocation, ephemeral) serverless /tmp.
 */

// Generous ceiling — recordings target ~10 MB per 3-5 min; 60 MB leaves room
// for long sessions while still rejecting absurd uploads.
const MAX_VIDEO_BYTES = 60 * 1024 * 1024;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as HandleUploadBody;
  try {
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ["video/mp4"],
        maximumSizeInBytes: MAX_VIDEO_BYTES,
        addRandomSuffix: true,
      }),
      onUploadCompleted: async () => {
        // No-op: the client triggers the Drive copy explicitly once upload()
        // resolves. This webhook only fires on deployed Vercel (it needs a
        // publicly reachable URL), so relying on it would break local dev.
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "token error" },
      { status: 400 },
    );
  }
}
