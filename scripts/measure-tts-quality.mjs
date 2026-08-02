import fs from "node:fs";
import path from "node:path";
import WebSocket from "ws";

const SAMPLE_RATE = 24000;
const MODEL = "eleven_flash_v2_5";
const HOST = "api.elevenlabs.io";
const VOICES = {
  roast: "EXAVITQu4vr4xnSDxMaL",
  toast: "vamKBH1qWYogA4WG6UPB",
};

function loadDotEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function args() {
  const parsed = new Map();
  for (let i = 2; i < process.argv.length; i++) {
    const key = process.argv[i];
    if (!key.startsWith("--")) continue;
    const value = process.argv[i + 1];
    if (value && !value.startsWith("--")) {
      parsed.set(key.slice(2), value);
      i++;
    } else {
      parsed.set(key.slice(2), "true");
    }
  }
  return parsed;
}

function numberArg(parsed, key, fallback) {
  const value = Number(parsed.get(key));
  return Number.isFinite(value) ? value : fallback;
}

function dbfs(value) {
  return value > 0 ? 20 * Math.log10(value) : -Infinity;
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return value;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function analyzePcm(bytes, chunkSizes, playbackGain) {
  const samples = new Int16Array(bytes.length / 2);
  let peak = 0;
  let sumSquares = 0;
  let clipped = 0;
  for (let i = 0; i < samples.length; i++) {
    const sample = bytes.readInt16LE(i * 2);
    samples[i] = sample;
    const normalized = Math.abs(sample) / 32768;
    peak = Math.max(peak, normalized);
    sumSquares += normalized * normalized;
    if (Math.abs(sample) >= 32760) clipped++;
  }

  const onsetSamples = Math.min(samples.length, Math.round(SAMPLE_RATE * 0.5));
  let onsetPeak = 0;
  let onsetSquares = 0;
  for (let i = 0; i < onsetSamples; i++) {
    const normalized = Math.abs(samples[i]) / 32768;
    onsetPeak = Math.max(onsetPeak, normalized);
    onsetSquares += normalized * normalized;
  }

  let boundaryOffset = 0;
  let maxBoundaryJump = 0;
  for (const chunkBytes of chunkSizes.slice(0, -1)) {
    boundaryOffset += chunkBytes / 2;
    if (boundaryOffset <= 0 || boundaryOffset >= samples.length) continue;
    const jump = Math.abs(samples[boundaryOffset] - samples[boundaryOffset - 1]) / 65535;
    maxBoundaryJump = Math.max(maxBoundaryJump, jump);
  }

  const rms = Math.sqrt(sumSquares / Math.max(1, samples.length));
  const onsetRms = Math.sqrt(onsetSquares / Math.max(1, onsetSamples));
  return {
    durationMs: round(samples.length / SAMPLE_RATE * 1000),
    samplePeakDbfs: round(dbfs(peak)),
    rmsDbfs: round(dbfs(rms)),
    crestFactorDb: round(dbfs(peak / Math.max(rms, Number.EPSILON))),
    clippedSamples: clipped,
    clippedPercent: round(clipped / Math.max(1, samples.length) * 100, 4),
    onset500msPeakDbfs: round(dbfs(onsetPeak)),
    onset500msRmsDbfs: round(dbfs(onsetRms)),
    postGainSamplePeakDbfs: round(dbfs(peak * playbackGain)),
    postGainRmsDbfs: round(dbfs(rms * playbackGain)),
    postGainOnset500msRmsDbfs: round(dbfs(onsetRms * playbackGain)),
    maxChunkBoundaryJump: round(maxBoundaryJump, 4),
  };
}

function wavFromPcm(pcm) {
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + pcm.length, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(SAMPLE_RATE, 24);
  wav.writeUInt32LE(SAMPLE_RATE * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(pcm.length, 40);
  pcm.copy(wav, 44);
  return wav;
}

function synthesize({ voiceId, text, voiceSettings }) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is missing");
  const params = new URLSearchParams({
    model_id: process.env.ELEVENLABS_MODEL_ID?.trim() || MODEL,
    output_format: "pcm_24000",
    "xi-api-key": apiKey,
  });
  const host = process.env.ELEVENLABS_API_HOST?.trim() || HOST;
  const url = `wss://${host}/v1/text-to-speech/${voiceId}/stream-input?${params}`;

  return new Promise((resolve, reject) => {
    const chunks = [];
    const chunkSizes = [];
    const startedAt = Date.now();
    let firstAudioMs = null;
    let settled = false;
    const ws = new WebSocket(url);
    const timeout = setTimeout(() => finish(new Error("TTS timed out")), 30000);
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try { ws.close(); } catch { /* already closed */ }
      if (error) reject(error);
      else resolve(result);
    };

    ws.on("open", () => {
      ws.send(JSON.stringify({
        text: " ",
        voice_settings: voiceSettings,
        xi_api_key: apiKey,
        generation_config: { chunk_length_schedule: [120, 160, 250, 290] },
      }));
      ws.send(JSON.stringify({ text, flush: true }));
      ws.send(JSON.stringify({ text: "" }));
    });
    ws.on("message", (data) => {
      const message = JSON.parse(data.toString());
      if (message.error) return finish(new Error(String(message.error)));
      if (message.audio) {
        if (firstAudioMs === null) firstAudioMs = Date.now() - startedAt;
        const chunk = Buffer.from(message.audio, "base64");
        chunks.push(chunk);
        chunkSizes.push(chunk.length);
      }
      if (message.isFinal) {
        const pcm = Buffer.concat(chunks);
        finish(null, { pcm, chunkSizes, firstAudioMs });
      }
    });
    ws.on("error", (error) => finish(error));
    ws.on("close", () => {
      if (!settled) finish(new Error("TTS socket closed before final audio"));
    });
  });
}

loadDotEnvLocal();
const parsed = args();
const experience = parsed.get("experience") || "toast";
if (!(experience in VOICES)) throw new Error(`Unknown experience: ${experience}`);
const text = parsed.get("text") || "Oh, hi! Everyone raise a glass. You look incredible tonight.";
const voiceSettings = {
  stability: numberArg(parsed, "stability", 0.5),
  similarity_boost: numberArg(parsed, "similarity", 0.5),
  style: numberArg(parsed, "style", 1),
  speed: numberArg(parsed, "speed", 1),
  use_speaker_boost: parsed.get("speaker-boost") !== "false",
};
const playbackGain = numberArg(parsed, "playback-gain", 1);
const result = await synthesize({ voiceId: VOICES[experience], text, voiceSettings });
const metrics = analyzePcm(result.pcm, result.chunkSizes, playbackGain);
const outputDir = path.join(process.cwd(), ".debug", "tts-quality");
fs.mkdirSync(outputDir, { recursive: true });
const label = parsed.get("label") || `${experience}-${Date.now()}`;
const wavPath = path.join(outputDir, `${label}.wav`);
const jsonPath = path.join(outputDir, `${label}.json`);
fs.writeFileSync(wavPath, wavFromPcm(result.pcm));
const report = {
  measuredAt: new Date().toISOString(),
  experience,
  text,
  voiceSettings,
  playbackGain,
  chunks: result.chunkSizes.length,
  firstAudioMs: result.firstAudioMs,
  ...metrics,
  wavPath,
};
fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, jsonPath }, null, 2));
