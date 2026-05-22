import { NextResponse } from "next/server";
import WebSocket from "ws";
import { ELEVENLABS_VOICE_ID } from "@/lib/constants";

/**
 * POST /api/prewarm-tts — Best-effort warm-up of the ElevenLabs connection.
 *
 * Opens a brief WebSocket to api.elevenlabs.io, completes the TLS handshake +
 * auth, then closes. The Node process keeps the TLS session ticket and the
 * DNS resolver caches the lookup. The NEXT real /api/tts-ws call gets a
 * faster handshake (the WS itself isn't reusable — different per-render).
 *
 * Caller fires this in parallel with the greeting prefetch right after the
 * user grants permissions, so EL is warm by the time we send real text.
 */
export async function POST() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "ELEVENLABS_API_KEY not set" });
  }

  const voiceId = process.env.ELEVENLABS_VOICE_ID ?? ELEVENLABS_VOICE_ID;
  const host = process.env.ELEVENLABS_API_HOST?.trim() || "api.elevenlabs.io";
  const modelId = process.env.ELEVENLABS_MODEL_ID?.trim() || "eleven_turbo_v2_5";

  const params = new URLSearchParams({
    model_id: modelId,
    output_format: "pcm_24000",
    "xi-api-key": apiKey,
  });
  const url = `wss://${host}/v1/text-to-speech/${voiceId}/stream-input?${params.toString()}`;

  return new Promise<Response>((resolve) => {
    const startedAt = Date.now();
    let settled = false;

    const finish = (ok: boolean, detail?: string) => {
      if (settled) return;
      settled = true;
      const ms = Date.now() - startedAt;
      resolve(NextResponse.json({ ok, ms, ...(detail ? { detail } : {}) }));
    };

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      finish(false, (e as Error).message);
      return;
    }

    // Hard cap — don't block more than 3s waiting on EL.
    const cap = setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* noop */
      }
      finish(false, "timeout");
    }, 3000);

    ws.on("open", () => {
      // Closing immediately after open is enough to cache DNS/TLS. We do NOT
      // send voice_settings or text — no synthesis is started.
      clearTimeout(cap);
      try {
        ws.close();
      } catch {
        /* noop */
      }
      finish(true);
    });

    ws.on("error", (err) => {
      clearTimeout(cap);
      finish(false, (err as Error).message);
    });
  });
}
