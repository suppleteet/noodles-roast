import { createReadStream } from "fs";
import { statSync } from "fs";
import { Transform } from "stream";
import { google, type drive_v3 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

interface UploadResult {
  fileId: string;
  webViewLink: string;
}

let cachedDrive: drive_v3.Drive | null = null;
let cachedFolderId: string | null = null;
let missingCredsWarned = false;

function getDriveClient(): { drive: drive_v3.Drive; folderId: string } | null {
  if (cachedDrive && cachedFolderId) {
    return { drive: cachedDrive, folderId: cachedFolderId };
  }

  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  if (!clientId || !clientSecret || !refreshToken || !folderId) {
    if (!missingCredsWarned) {
      console.warn("[gdrive-upload] missing credentials, skipping (set GOOGLE_DRIVE_* env vars to enable)");
      missingCredsWarned = true;
    }
    return null;
  }

  const oauth2: OAuth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });

  cachedDrive = google.drive({ version: "v3", auth: oauth2 });
  cachedFolderId = folderId;
  return { drive: cachedDrive, folderId: cachedFolderId };
}

export async function uploadVideoToDrive(
  filePath: string,
  filename: string,
): Promise<UploadResult | null> {
  const client = getDriveClient();
  if (!client) return null;

  try {
    const resp = await client.drive.files.create({
      requestBody: {
        name: filename,
        parents: [client.folderId],
      },
      media: {
        mimeType: "video/mp4",
        body: createReadStream(filePath),
      },
      fields: "id, webViewLink",
    });

    const fileId = resp.data.id;
    const webViewLink = resp.data.webViewLink;
    if (!fileId || !webViewLink) {
      console.warn("[gdrive-upload] response missing id/webViewLink", resp.data);
      return null;
    }
    return { fileId, webViewLink };
  } catch (err) {
    // Surface code/status so future failures (auth expired vs rate limit vs
    // folder deleted) are distinguishable without re-running with a debugger.
    const e = err as { code?: unknown; status?: unknown; message?: unknown };
    console.error(
      `[gdrive-upload] upload failed (code=${String(e.code)} status=${String(e.status)}):`,
      e.message ?? err,
    );
    return null;
  }
}

/**
 * Same as uploadVideoToDrive, but emits per-chunk progress as bytes flow
 * through the upload stream. Used by /api/upload-to-drive to drive the
 * Send-to-Tyler UI progress bar.
 *
 * `onProgress` is called with `{ uploadedBytes, totalBytes }` for each chunk
 * the SDK sends; callers can rate-limit if they like. Errors are surfaced as
 * a thrown Error so the caller can report a failure event.
 */
export async function uploadVideoToDriveWithProgress(
  filePath: string,
  filename: string,
  onProgress: (state: { uploadedBytes: number; totalBytes: number }) => void,
): Promise<UploadResult | null> {
  const client = getDriveClient();
  if (!client) return null;

  const totalBytes = statSync(filePath).size;
  let uploadedBytes = 0;

  // Wrap the file read stream in a counting Transform so we can emit progress
  // for each chunk. The googleapis SDK pipes the body into its multipart
  // request; bytes that pass through here are bytes that have left the server
  // toward Google Drive. (Drive uploads via the v3 SDK don't expose a native
  // progress callback for the simple media upload path.)
  const readStream = createReadStream(filePath);
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      uploadedBytes += chunk.length;
      try { onProgress({ uploadedBytes, totalBytes }); } catch { /* ignore listener errors */ }
      cb(null, chunk);
    },
  });
  readStream.pipe(counter);
  readStream.on("error", (err) => counter.destroy(err));

  try {
    const resp = await client.drive.files.create({
      requestBody: {
        name: filename,
        parents: [client.folderId],
      },
      media: {
        mimeType: "video/mp4",
        body: counter,
      },
      fields: "id, webViewLink",
    });

    const fileId = resp.data.id;
    const webViewLink = resp.data.webViewLink;
    if (!fileId || !webViewLink) {
      console.warn("[gdrive-upload] response missing id/webViewLink", resp.data);
      return null;
    }
    // Ensure the final progress event lands at 100% even if the last chunk
    // arrived before the create() promise resolved.
    onProgress({ uploadedBytes: totalBytes, totalBytes });
    return { fileId, webViewLink };
  } catch (err) {
    const e = err as { code?: unknown; status?: unknown; message?: unknown };
    console.error(
      `[gdrive-upload] upload failed (code=${String(e.code)} status=${String(e.status)}):`,
      e.message ?? err,
    );
    throw err instanceof Error ? err : new Error(String(err));
  }
}
