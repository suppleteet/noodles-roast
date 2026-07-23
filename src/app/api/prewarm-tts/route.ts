import { NextResponse } from "next/server";
import WebSocket from "ws";
import {
  DEFAULT_ELEVENLABS_MODEL_ID,
  ELEVENLABS_VOICE_ID,
  TOAST_VOICE_ID,
} from "@/lib/constants";

const PREWARM_COOLDOWN_MS = 30_000;
const nextAllowedByClient = new Map<string, number>();

/**
 * POST /api/prewarm-tts — Best-effort warm-up of the ElevenLabs synthesis path.
 *
 * Opens a WebSocket to api.elevenlabs.io and runs a TINY real synthesis (one
 * word), waiting for the FIRST audio chunk before closing. This warms more than
 * DNS/TLS: it pays the EL-side model/voice cold-start once, up front, so the
 * first REAL session line streams its first audio fast instead of ~5s cold
 * (field-observed: the canned opener's first audio took 5256ms, blowing TTFS to
 * 8s — every later call in the same session was sub-1.5s). An earlier version
 * only opened+closed the socket and never started synthesis, so it never warmed
 * this; that was the bug.
 *
 * Caller fires this in parallel with the greeting prefetch right after the
 * user grants permissions, so EL is warm by the time we send real text.
 *
 * `?voice=toast` warms the Toast voice instead of the default Roast voice.
 */
export async function POST(req: Request) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "ELEVENLABS_API_KEY not set" });
  }

  const wantToast = new URL(req.url).searchParams.get("voice") === "toast";
  const forwardedFor = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const clientKey = `${forwardedFor || "local"}:${wantToast ? "toast" : "roast"}`;
  const now = Date.now();
  if ((nextAllowedByClient.get(clientKey) ?? 0) > now) {
    return NextResponse.json({ ok: true, cached: true });
  }
  nextAllowedByClient.set(clientKey, now + PREWARM_COOLDOWN_MS);
  if (nextAllowedByClient.size > 500) {
    for (const [key, nextAllowed] of nextAllowedByClient) {
      if (nextAllowed <= now) nextAllowedByClient.delete(key);
    }
  }
  const voiceId = wantToast
    ? process.env.ELEVENLABS_TOAST_VOICE_ID?.trim() || TOAST_VOICE_ID
    : process.env.ELEVENLABS_VOICE_ID?.trim() || ELEVENLABS_VOICE_ID;
  const host = process.env.ELEVENLABS_API_HOST?.trim() || "api.elevenlabs.io";
  const modelId =
    process.env.ELEVENLABS_MODEL_ID?.trim() || DEFAULT_ELEVENLABS_MODEL_ID;

  const params = new URLSearchParams({
    model_id: modelId,
    output_format: "pcm_24000",
    "xi-api-key": apiKey,
  });
  const url = `wss://${host}/v1/text-to-speech/${voiceId}/stream-input?${params.toString()}`;

  return new Promise<Response>((resolve) => {
    const startedAt = Date.now();
    let settled = false;
    let ws: WebSocket;

    const finish = (ok: boolean, detail?: string) => {
      if (settled) return;
      settled = true;
      try {
        ws?.close();
      } catch {
        /* noop */
      }
      const ms = Date.now() - startedAt;
      resolve(NextResponse.json({ ok, ms, ...(detail ? { detail } : {}) }));
    };

    try {
      ws = new WebSocket(url);
    } catch {
      finish(false, "connection_failed");
      return;
    }

    // Hard cap — don't block more than 6s waiting on a cold EL synthesis.
    // (Higher than the old 3s because we now wait for actual audio, not just
    // the socket open; a cold first synth is exactly the ~5s we're warming away.)
    const cap = setTimeout(() => finish(false, "timeout"), 6000);

    ws.on("open", () => {
      // Send the handshake + one word + flush + end-of-input, mirroring the real
      // streamElTts handshake so EL spins up the same synthesis pipeline.
      try {
        ws.send(
          JSON.stringify({
            text: " ",
            voice_settings: { stability: 0.5, similarity_boost: 0.7 },
            xi_api_key: apiKey,
          }),
        );
        ws.send(JSON.stringify({ text: "warm", flush: true }));
        ws.send(JSON.stringify({ text: "" }));
      } catch {
        clearTimeout(cap);
        finish(false, "send_failed");
      }
    });

    ws.on("message", (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString()) as { audio?: string; error?: string };
        if (msg.error) {
          clearTimeout(cap);
          finish(false, "provider_error");
          return;
        }
        // First audio chunk = the synthesis pipeline is hot. Done warming.
        if (msg.audio) {
          clearTimeout(cap);
          finish(true);
        }
      } catch {
        /* ignore non-JSON frames */
      }
    });

    ws.on("error", () => {
      clearTimeout(cap);
      finish(false, "connection_failed");
    });
  });
}
