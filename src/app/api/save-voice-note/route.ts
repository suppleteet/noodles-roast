import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, readdir, unlink } from "fs/promises";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import { VISION_MODEL } from "@/lib/constants";
import { recordGeminiUsage } from "@/lib/usageTracker";
import { geminiThinkingConfig } from "@/lib/geminiThinking";

export const dynamic = "force-dynamic";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const NOTES_DIR = path.join(process.cwd(), ".debug", "voice-notes");
const MAX_NOTES = 50;
const MAX_BODY = 10_000_000; // 10 MB

export async function POST(req: NextRequest) {
  try {
    const rawContentLength = req.headers.get("content-length");
    const contentLength = Number(rawContentLength);
    if (
      !rawContentLength ||
      !/^\d+$/.test(rawContentLength) ||
      !Number.isSafeInteger(contentLength) ||
      contentLength <= 0
    ) {
      return NextResponse.json(
        { error: "Content-Length required" },
        { status: 411 },
      );
    }
    if (contentLength > MAX_BODY) {
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }

    const formData = await req.formData();
    const audioEntry = formData.get("audio");
    const contextEntry = formData.get("context");
    const indexEntry = formData.get("index");
    const sessionTsEntry = formData.get("sessionTs");
    const sessionLogEntry = formData.get("sessionLog");
    const audioFile = audioEntry instanceof File ? audioEntry : null;
    const context =
      typeof contextEntry === "string" ? contextEntry.slice(0, 500) : "unknown";
    const parsedNoteIndex =
      typeof indexEntry === "string" && /^\d{1,6}$/.test(indexEntry)
        ? Number(indexEntry)
        : null;
    const sessionTs =
      typeof sessionTsEntry === "string" && /^\d{1,16}$/.test(sessionTsEntry)
        ? Number(sessionTsEntry)
        : 0;
    const sessionLog =
      typeof sessionLogEntry === "string" ? sessionLogEntry.slice(0, 1_000_000) : null;

    if (!audioFile || audioFile.size === 0) {
      return NextResponse.json({ error: "No audio provided" }, { status: 400 });
    }
    if (audioFile.size > MAX_BODY) {
      return NextResponse.json({ error: "Audio too large" }, { status: 413 });
    }
    if (parsedNoteIndex === null) {
      return NextResponse.json({ error: "Invalid note index" }, { status: 400 });
    }

    // Transcribe audio via Gemini
    const audioBuffer = await audioFile.arrayBuffer();
    const audioBase64 = Buffer.from(audioBuffer).toString("base64");
    const mimeType = audioFile.type || "audio/webm";

    let transcript = "";
    try {
      const response = await ai.models.generateContent({
        model: VISION_MODEL,
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType, data: audioBase64 } },
              { text: "Transcribe this audio exactly as spoken. Return ONLY the transcription text, nothing else." },
            ],
          },
        ],
        config: {
          thinkingConfig: geminiThinkingConfig(VISION_MODEL, "realtime-utility"),
          maxOutputTokens: 2000,
        },
      });
      transcript = (response.text ?? "").trim();
      recordGeminiUsage({
        route: "voice-note-transcribe",
        model: VISION_MODEL,
        text: transcript,
        userText: "Transcribe this audio exactly as spoken. Return ONLY the transcription text, nothing else.",
        usageMetadata: response.usageMetadata,
      });
    } catch (e) {
      console.error("[save-voice-note] transcription failed:", e);
      transcript = "[transcription failed]";
    }

    // Save as JSON with transcript + session log
    await mkdir(NOTES_DIR, { recursive: true });

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `note-${parsedNoteIndex}-${ts}.json`;

    const note: Record<string, unknown> = {
      transcript,
      context,
      noteIndex: parsedNoteIndex,
      sessionTs,
      recordedAt: new Date().toISOString(),
      audioSizeBytes: audioBuffer.byteLength,
    };

    // Include session log if provided
    if (sessionLog) {
      try {
        note.sessionLog = JSON.parse(sessionLog);
      } catch {
        note.sessionLog = sessionLog;
      }
    }

    await writeFile(
      path.join(NOTES_DIR, filename),
      JSON.stringify(note, null, 2),
      "utf-8",
    );

    // Prune old notes
    const files = (await readdir(NOTES_DIR))
      .filter((f) => f.startsWith("note-") && f.endsWith(".json"))
      .sort();
    if (files.length > MAX_NOTES) {
      for (const old of files.slice(0, files.length - MAX_NOTES)) {
        await unlink(path.join(NOTES_DIR, old)).catch(() => {});
      }
    }

    console.log(`[save-voice-note] "${transcript.slice(0, 80)}" → ${filename}`);
    return NextResponse.json({ ok: true, transcript, filename });
  } catch (err) {
    console.error("[save-voice-note]", err);
    return NextResponse.json({ error: "Failed to save voice note" }, { status: 500 });
  }
}
