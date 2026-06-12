import { Readable } from "stream";
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

/**
 * Streams a video that already lives at a remote URL (a Vercel Blob URL) into
 * Drive without ever staging it on the local/serverless filesystem. This is
 * the prod path: the browser uploads the recording to Vercel Blob, then asks
 * /api/upload-to-drive to copy that durable URL here — which survives across
 * serverless invocations, unlike the old read-from-/tmp approach.
 *
 * Returns null if Drive credentials aren't configured; throws on fetch/upload
 * failure so the caller can surface a real error.
 */
export async function uploadRemoteVideoToDrive(
  sourceUrl: string,
  filename: string,
): Promise<UploadResult | null> {
  const client = getDriveClient();
  if (!client) return null;

  const resp = await fetch(sourceUrl);
  if (!resp.ok || !resp.body) {
    throw new Error(`failed to fetch source blob (${resp.status})`);
  }
  // googleapis wants a Node Readable for the media body; fetch gives a WHATWG
  // web stream. Readable.fromWeb bridges them. Cast is needed because Node's
  // lib types and the DOM ReadableStream type don't structurally line up.
  const nodeStream = Readable.fromWeb(
    resp.body as unknown as Parameters<typeof Readable.fromWeb>[0],
  );

  try {
    const driveResp = await client.drive.files.create({
      requestBody: {
        name: filename,
        parents: [client.folderId],
      },
      media: {
        mimeType: "video/mp4",
        body: nodeStream,
      },
      fields: "id, webViewLink",
    });

    const fileId = driveResp.data.id;
    const webViewLink = driveResp.data.webViewLink;
    if (!fileId || !webViewLink) {
      console.warn("[gdrive-upload] response missing id/webViewLink", driveResp.data);
      return null;
    }
    return { fileId, webViewLink };
  } catch (err) {
    const e = err as { code?: unknown; status?: unknown; message?: unknown };
    console.error(
      `[gdrive-upload] remote upload failed (code=${String(e.code)} status=${String(e.status)}):`,
      e.message ?? err,
    );
    throw err instanceof Error ? err : new Error(String(err));
  }
}

