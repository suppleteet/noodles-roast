import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import WebSocket from "ws";

const SAMPLE_RATE = 24000;
const DEFAULT_MODEL = "eleven_turbo_v2_5";
const DEFAULT_HOST = "api.elevenlabs.io";
const OUTPUT_FORMAT = "pcm_24000";
const DEFAULT_TEXT = "Hello there! Who is this?";
const DEFAULT_SCHEDULE = [120, 160, 250, 290];

function loadDotEnvLocal() {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function parseArgs() {
  const args = new Map();
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = process.argv[i + 1];
    if (next && !next.startsWith("--")) {
      args.set(key, next);
      i++;
    } else {
      args.set(key, "true");
    }
  }
  return args;
}

function startupVoiceSettings({ styleCap, baseSpeed, speedCap, capStage }) {
  const base = {
    stability: 0.72,
    similarity_boost: 0.7,
    style: capStage === "before-motion" ? Math.min(1, styleCap) : 1,
    speed: capStage === "before-motion" && Number.isFinite(speedCap)
      ? Math.min(baseSpeed, speedCap)
      : baseSpeed,
    use_speaker_boost: true,
  };
  const intensity = 0.6;
  const deadpan = { stability: 0.22, style: -0.18, speed: -0.05 };
  const merged = {
    ...base,
    stability: clamp(base.stability + deadpan.stability * intensity, 0.2, 1),
    style: clamp(base.style + deadpan.style * intensity, 0, 1),
    speed: clamp(base.speed + deadpan.speed * intensity, 0.7, 1.2),
  };
  if (capStage === "after-motion") {
    return {
      ...merged,
      style: Math.min(merged.style, styleCap),
      speed: Number.isFinite(speedCap) ? Math.min(merged.speed, speedCap) : merged.speed,
    };
  }
  return merged;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function pcmBase64ToFloat32(chunks) {
  const buffers = chunks.map((chunk) => Buffer.from(chunk, "base64"));
  const bytes = Buffer.concat(buffers);
  const sampleCount = Math.floor(bytes.length / 2);
  const pcm = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const value = bytes.readInt16LE(i * 2);
    pcm[i] = value / (value < 0 ? 0x8000 : 0x7fff);
  }
  return pcm;
}

function estimatePitchFrame(frame, sampleRate) {
  let mean = 0;
  for (const sample of frame) mean += sample;
  mean /= frame.length;

  let energy = 0;
  const centered = new Float32Array(frame.length);
  for (let i = 0; i < frame.length; i++) {
    const sample = frame[i] - mean;
    centered[i] = sample;
    energy += sample * sample;
  }
  const rms = Math.sqrt(energy / frame.length);
  if (rms < 0.012) return null;

  const minLag = Math.floor(sampleRate / 420);
  const maxLag = Math.floor(sampleRate / 60);
  let bestLag = 0;
  let bestCorr = -Infinity;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    let a = 0;
    let b = 0;
    for (let i = 0; i < centered.length - lag; i++) {
      const x = centered[i];
      const y = centered[i + lag];
      corr += x * y;
      a += x * x;
      b += y * y;
    }
    const norm = corr / Math.sqrt(a * b || 1);
    if (norm > bestCorr) {
      bestCorr = norm;
      bestLag = lag;
    }
  }

  if (bestCorr < 0.35 || bestLag === 0) return null;
  return { hz: sampleRate / bestLag, confidence: bestCorr, rms };
}

function analyzePitch(pcm, sampleRate) {
  const frameSize = Math.round(sampleRate * 0.04);
  const hop = Math.round(sampleRate * 0.01);
  const pitches = [];
  const rmsValues = [];

  for (let start = 0; start + frameSize <= pcm.length; start += hop) {
    const pitch = estimatePitchFrame(pcm.subarray(start, start + frameSize), sampleRate);
    if (!pitch) continue;
    pitches.push(pitch.hz);
    rmsValues.push(pitch.rms);
  }

  pitches.sort((a, b) => a - b);
  rmsValues.sort((a, b) => a - b);
  const percentile = (values, p) => {
    if (!values.length) return null;
    const idx = Math.min(values.length - 1, Math.max(0, Math.round((values.length - 1) * p)));
    return values[idx];
  };

  return {
    voicedFrames: pitches.length,
    medianHz: round(percentile(pitches, 0.5)),
    p10Hz: round(percentile(pitches, 0.1)),
    p90Hz: round(percentile(pitches, 0.9)),
    maxHz: round(pitches[pitches.length - 1] ?? null),
    medianRms: round(percentile(rmsValues, 0.5), 4),
  };
}

function round(value, digits = 1) {
  if (value === null || value === undefined) return null;
  const m = 10 ** digits;
  return Math.round(value * m) / m;
}

function collectTts({ text, previousText, voiceSettings }) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is missing");
  if (!voiceId) throw new Error("ELEVENLABS_VOICE_ID is missing");

  const params = new URLSearchParams({
    model_id: process.env.ELEVENLABS_MODEL_ID?.trim() || DEFAULT_MODEL,
    output_format: OUTPUT_FORMAT,
    "xi-api-key": apiKey,
  });
  const host = process.env.ELEVENLABS_API_HOST?.trim() || DEFAULT_HOST;
  const url = `wss://${host}/v1/text-to-speech/${voiceId}/stream-input?${params.toString()}`;
  const chunks = [];
  const chunkBytes = [];
  const startedAt = Date.now();
  let firstAudioMs = null;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timeout = setTimeout(() => {
      try {
        ws.close();
      } catch {}
      reject(new Error("Timed out waiting for ElevenLabs TTS"));
    }, 20000);

    ws.on("open", () => {
      ws.send(JSON.stringify({
        text: " ",
        voice_settings: voiceSettings,
        xi_api_key: apiKey,
        generation_config: { chunk_length_schedule: DEFAULT_SCHEDULE },
        ...(previousText ? { previous_text: previousText } : {}),
      }));
      ws.send(JSON.stringify({ text, flush: true }));
      ws.send(JSON.stringify({ text: "" }));
    });

    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.error) {
        clearTimeout(timeout);
        ws.close();
        reject(new Error(msg.error));
        return;
      }
      if (msg.audio) {
        if (firstAudioMs === null) firstAudioMs = Date.now() - startedAt;
        chunks.push(msg.audio);
        chunkBytes.push(Buffer.byteLength(msg.audio, "base64"));
      }
      if (msg.isFinal) {
        clearTimeout(timeout);
        ws.close();
        const pcmBytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk, "base64")));
        const pcm = pcmBase64ToFloat32(chunks);
        resolve({
          chunks: chunks.length,
          chunkBytes,
          pcmSha256: crypto.createHash("sha256").update(pcmBytes).digest("hex"),
          firstAudioMs,
          samples: pcm.length,
          durationMs: round((pcm.length / SAMPLE_RATE) * 1000),
          pitch: analyzePitch(pcm, SAMPLE_RATE),
        });
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    ws.on("close", () => clearTimeout(timeout));
  });
}

loadDotEnvLocal();
const args = parseArgs();
const text = args.get("text") || DEFAULT_TEXT;
const mode = args.get("previous") || "none";
const styleCap = Number(args.get("style-cap") || 0.5);
const baseSpeed = Number(args.get("base-speed") || 1.0);
const speedCapArg = args.get("speed-cap");
const speedCap = speedCapArg === undefined ? Number.NaN : Number(speedCapArg);
const capStage = args.get("cap-stage") || "after-motion";
const previousText = mode === "same" ? text : (mode === "none" ? "" : mode);
const voiceSettings = startupVoiceSettings({ styleCap, baseSpeed, speedCap, capStage });

const result = await collectTts({ text, previousText, voiceSettings });
const report = {
  measuredAt: new Date().toISOString(),
  text,
  previousTextMode: mode,
  previousTextLength: previousText.length,
  sampleRate: SAMPLE_RATE,
  capStage,
  styleCap,
  baseSpeed,
  speedCap: Number.isFinite(speedCap) ? speedCap : null,
  voiceSettings,
  ...result,
};

fs.mkdirSync(path.join(process.cwd(), ".debug"), { recursive: true });
const out = path.join(
  process.cwd(),
  ".debug",
  `startup-tts-pitch-${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}-${mode}.json`,
);
fs.writeFileSync(out, JSON.stringify(report, null, 2));

console.log(JSON.stringify({ ...report, output: out }, null, 2));
