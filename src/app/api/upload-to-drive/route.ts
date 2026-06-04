import { NextRequest } from "next/server";
import { join } from "path";
import { existsSync } from "fs";
import { VIDEOS_FOLDER } from "@/lib/videoPaths";
import { isSafeVideoFilename } from "@/lib/mediaRecorderSupport";
import { uploadVideoToDriveWithProgress } from "@/lib/googleDriveUpload";

/**
 * Triggered by the "Send to Tyler" button. The video has already been saved
 * + converted by /api/save-video; this route streams it to Drive and emits
 * SSE progress events so the UI can show a live progress bar.
 *
 * SSE event shape:
 *   { type: "progress", uploadedBytes, totalBytes }
 *   { type: "complete", webViewLink, fileId }
 *   { type: "error", message }
 *
 * The connection closes after `complete` or `error`.
 */
export async function POST(req: NextRequest) {
  const { filename } = (await req.json().catch(() => ({}))) as { filename?: string };
  if (!isSafeVideoFilename(filename)) {
    return new Response(JSON.stringify({ error: "Invalid filename" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const filePath = join(VIDEOS_FOLDER, filename);
  if (!existsSync(filePath)) {
    return new Response(JSON.stringify({ error: "File not found on server" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      // Rate-limit progress events to ~10/sec so a small video doesn't flood
      // the channel with thousands of progress messages.
      let lastEmitTs = 0;
      const minIntervalMs = 100;

      try {
        const result = await uploadVideoToDriveWithProgress(
          filePath,
          filename,
          ({ uploadedBytes, totalBytes }) => {
            const now = Date.now();
            const atEnd = uploadedBytes >= totalBytes;
            if (atEnd || now - lastEmitTs >= minIntervalMs) {
              lastEmitTs = now;
              send({ type: "progress", uploadedBytes, totalBytes });
            }
          },
        );

        if (!result) {
          send({ type: "error", message: "Drive credentials not configured" });
        } else {
          send({ type: "complete", webViewLink: result.webViewLink, fileId: result.fileId });
        }
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
