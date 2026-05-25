import { readFile } from "fs/promises";

interface UploadResult {
  path: string;
  size: number;
}

let missingTokenWarned = false;

export async function uploadVideoToDropbox(
  filePath: string,
  filename: string,
): Promise<UploadResult | null> {
  const token = process.env.DROPBOX_ACCESS_TOKEN;
  if (!token) {
    if (!missingTokenWarned) {
      console.warn(
        "[dropbox-upload] DROPBOX_ACCESS_TOKEN missing, skipping (set in .env.local to enable)",
      );
      missingTokenWarned = true;
    }
    return null;
  }

  try {
    const buf = await readFile(filePath);
    // Path is relative to the app's folder when the Dropbox app uses
    // "App folder" scope — files land in /Apps/<AppName>/<filename> in Tyler's
    // Dropbox. autorename avoids collisions; mute suppresses notification spam.
    const args = {
      path: `/${filename}`,
      mode: "add" as const,
      autorename: true,
      mute: true,
    };
    const resp = await fetch("https://content.dropboxapi.com/2/files/upload", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Dropbox-API-Arg": JSON.stringify(args),
        "Content-Type": "application/octet-stream",
      },
      // Pass the Buffer directly (it's already a Uint8Array subclass).
      // new Uint8Array(buf) would allocate a copy of the whole video.
      body: buf,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      console.error(
        `[dropbox-upload] upload failed (status=${resp.status}): ${text.slice(0, 300)}`,
      );
      return null;
    }
    const data = (await resp.json()) as { path_display?: string; size?: number };
    if (!data.path_display) {
      console.warn("[dropbox-upload] response missing path_display:", data);
      return null;
    }
    return { path: data.path_display, size: data.size ?? buf.length };
  } catch (err) {
    const e = err as { code?: unknown; message?: unknown };
    console.error(
      `[dropbox-upload] upload failed (code=${String(e.code)}):`,
      e.message ?? err,
    );
    return null;
  }
}
