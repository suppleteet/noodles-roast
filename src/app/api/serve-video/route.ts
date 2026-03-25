import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join, basename } from "path";
import { VIDEOS_FOLDER } from "@/lib/videoPaths";

export async function GET(req: NextRequest) {
  const filename = req.nextUrl.searchParams.get("filename");

  // Reject empty, path-traversal, or non-mp4 filenames.
  if (
    !filename ||
    filename !== basename(filename) ||
    !filename.endsWith(".mp4")
  ) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  const filePath = join(VIDEOS_FOLDER, filename);
  try {
    const data = await readFile(filePath);
    return new NextResponse(data, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(data.byteLength),
        // Allow the client to seek by range (needed for duration on some browsers)
        "Accept-Ranges": "bytes",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
