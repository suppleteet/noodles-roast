"use client";
import { useRef, useEffect, useCallback } from "react";
import { useSessionStore } from "@/store/useSessionStore";
import { OUTPUT_SAMPLE_RATE } from "@/lib/liveConstants";
import { base64Pcm16ToFloat32 } from "@/lib/audioUtils";

const AMPLITUDE_THRESHOLD = 0.01;

/** Linear-interpolate Float32 PCM from one sample rate to another. */
function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate || input.length === 0) return input;
  const ratio = fromRate / toRate;
  const outLen = Math.max(1, Math.round(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * ratio;
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, input.length - 1);
    const frac = srcIdx - lo;
    out[i] = input[lo] * (1 - frac) + input[hi] * frac;
  }
  return out;
}

export interface PcmPlaybackHandle {
  /** `gain` (≤ 1.0) ducks this chunk for per-line volume direction (e.g. conspiratorial lean-in). */
  enqueueChunk(base64Pcm: string, gain?: number): void;
  /** Decode a raw MP3/AAC ArrayBuffer and schedule it for playback. */
  decodeAndEnqueue(arrayBuffer: ArrayBuffer, gain?: number): Promise<void>;
  flush(): void;
  getDestinationStream(): MediaStream | null;
  getAudioContext(): AudioContext | null;
  /** Returns true when all queued audio has finished playing. */
  isQueueEmpty(): boolean;
  /** Returns milliseconds of audio remaining in the queue (0 when empty). */
  getPlaybackRemainingMs(): number;
  /** Route an external stream (e.g. mic) to the recording destination only
   *  (NOT speakers — avoids feedback). Returns a disconnect function. */
  addInputToRecording(stream: MediaStream): () => void;
  /** Create and resume the AudioContext after media permission has resolved. */
  warmUp(): Promise<void>;
}

/**
 * Hook that plays incoming base64-encoded PCM audio chunks from Gemini Live API.
 *
 * Schedules AudioBufferSourceNodes in sequence for gapless playback.
 * Polls amplitude via AnalyserNode for mouth sync (same pattern as AudioPlayer).
 */
/** Master output cap for puppet TTS. Toast's voice in particular hits hot
 *  peaks that distort on Android — capping at 0.7 (≈ −3 dB) tames the
 *  loudest moments without making conversational-volume lines feel quiet.
 *  Recording still captures the un-attenuated analyser output, so the
 *  saved video keeps full headroom. */
const MASTER_PLAYBACK_GAIN = 0.7;

/** How long after an AudioContext starts RUNNING its output is untrustworthy.
 *  The first ~500ms can play at the wrong rate (pitch warble + crackle) —
 *  field-reproduced on Chrome (Windows and Android; iOS documents the same
 *  WebKit behavior). A 200ms pre-roll tested as too short — the opener still
 *  came out high-pitched. 600ms covers the observed window with margin. */
const CTX_GLITCH_WINDOW_MS = 600;

/**
 * Regression guard: the old Android-only MediaStream → hidden <audio> bridge
 * introduced a second playback clock. Chrome could begin at the wrong rate
 * and slowly converge, producing the live-only "chipmunk" opener while the
 * recording (captured before that bridge) remained correct.
 */
export function shouldUseMediaElementPlaybackBridge(): false {
  return false;
}

export function usePcmPlayback(): PcmPlaybackHandle {
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recordingDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const queueEndRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const rafRef = useRef<number>(0);
  const lastAmplitudeRef = useRef<number>(0);
  const amplitudeDataRef = useRef<Float32Array<ArrayBuffer>>(new Float32Array(256));
  const preRollDoneRef = useRef<boolean>(false);
  const ctxRunningSinceRef = useRef<number | null>(null);

  function getOrCreateContext(): AudioContext {
    let ctx = ctxRef.current;
    if (!ctx || ctx.state === "closed") {
      // This hook mounts only after camera/mic permission resolves. Creating
      // the playback context here is intentional: warming it before getUserMedia
      // can leave Chrome holding the pre-permission device sample rate while
      // the audio stack switches devices underneath it.
      ctx = new AudioContext({ latencyHint: "playback" });
      ctxRef.current = ctx;
      ctxRunningSinceRef.current = null;
      const markRunning = () => {
        if (ctx?.state === "running" && ctxRunningSinceRef.current === null) {
          ctxRunningSinceRef.current = performance.now();
        }
      };
      markRunning();
      ctx.addEventListener("statechange", markRunning);
      preRollDoneRef.current = false;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.3;
      analyserRef.current = analyser;

      // ── Output chains ────────────────────────────────────────────────
      // RECORDING: analyser → recordingDest (un-attenuated, full quality
      // captured into the MP4).
      const recordingDest = ctx.createMediaStreamDestination();
      recordingDestRef.current = recordingDest;
      analyser.connect(recordingDest);

      // PLAYBACK: analyser -> masterGain -> speakers.
      //
      // Use the AudioContext destination directly on every platform. The old
      // Android-only MediaStream -> hidden <audio> bridge added another clock
      // and resampler after the recording branch, exactly matching the observed
      // "live sounds pitched, saved video sounds normal" failure.
      const masterGain = ctx.createGain();
      masterGain.gain.value = MASTER_PLAYBACK_GAIN;
      masterGainRef.current = masterGain;
      analyser.connect(masterGain);
      masterGain.connect(ctx.destination);
      useSessionStore.getState().logTiming("audio: speaker route=direct-destination");
    }
    return ctx;
  }

  // Amplitude polling — drives puppet mouth sync via store
  const pollAmplitude = useCallback(() => {
    const analyser = analyserRef.current;
    if (analyser) {
      const data = amplitudeDataRef.current;
      analyser.getFloatTimeDomainData(data);
      let sumSq = 0;
      for (let i = 0; i < data.length; i++) sumSq += data[i] * data[i];
      const rms = Math.min(Math.sqrt(sumSq / data.length) * 6, 1);
      if (Math.abs(rms - lastAmplitudeRef.current) >= AMPLITUDE_THRESHOLD) {
        lastAmplitudeRef.current = rms;
        useSessionStore.getState().setAudioAmplitude(rms);
      }
    }
    rafRef.current = requestAnimationFrame(pollAmplitude);
  }, []);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(pollAmplitude);
    return () => cancelAnimationFrame(rafRef.current);
  }, [pollAmplitude]);

  /** Schedule an already-decoded AudioBuffer for gapless playback.
   *  `gain` ducks the line pre-analyser so volume direction lands in both the
   *  speakers and the recording. Duck-only by contract (see gainForMotion). */
  const scheduleBuffer = useCallback((buffer: AudioBuffer, gain = 1) => {
    const ctx = getOrCreateContext();

    // First real audio on this context binding: cover whatever remains of the
    // startup glitch window (CTX_GLITCH_WINDOW_MS after the context started
    // RUNNING) with silence. When the context was gesture-warmed at the Start
    // button, it's been running for seconds and this is a no-op — zero TTFS
    // cost. When it was created late (fallback), the full window is pre-rolled
    // so the glitch burns on silence instead of the opener's first words.
    if (!preRollDoneRef.current) {
      preRollDoneRef.current = true;
      const runningMs =
        ctxRunningSinceRef.current === null
          ? 0
          : performance.now() - ctxRunningSinceRef.current;
      const needMs = Math.max(0, CTX_GLITCH_WINDOW_MS - runningMs);
      // Always log the first-buffer context state — this line is how session
      // logs prove which warm path ran when diagnosing pitched/garbled openers.
      useSessionStore.getState().logTiming(
        `audio: first buffer — ctx rate=${ctx.sampleRate} state=${ctx.state} running=${Math.round(runningMs)}ms pre-roll=${Math.round(needMs)}ms`,
      );
      if (needMs > 0) {
        const silence = ctx.createBuffer(1, Math.round((ctx.sampleRate * needMs) / 1000), ctx.sampleRate);
        const silenceSrc = ctx.createBufferSource();
        silenceSrc.buffer = silence;
        silenceSrc.connect(analyserRef.current!);
        const t = Math.max(ctx.currentTime, queueEndRef.current);
        silenceSrc.start(t);
        queueEndRef.current = t + silence.duration;
      }
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    if (gain !== 1) {
      const g = ctx.createGain();
      g.gain.value = gain;
      src.connect(g);
      g.connect(analyserRef.current!);
      src.onended = () => {
        sourcesRef.current.delete(src);
        try { g.disconnect(); } catch { /* already gone */ }
      };
    } else {
      src.connect(analyserRef.current!);
      src.onended = () => sourcesRef.current.delete(src);
    }
    const startTime = Math.max(ctx.currentTime, queueEndRef.current);
    src.start(startTime);
    queueEndRef.current = startTime + buffer.duration;
    sourcesRef.current.add(src);
  }, []);

  const enqueueChunk = useCallback((base64Pcm: string, gain = 1) => {
    const ctx = getOrCreateContext();
    if (ctx.state === "suspended") ctx.resume();

    const raw = base64Pcm16ToFloat32(base64Pcm);
    if (raw.length === 0) return;

    // Manual resample to ctx.sampleRate. iOS Safari sometimes silently coerces a
    // 24kHz AudioContext to the device default (48kHz) AND has a startup glitch
    // where AudioBufferSourceNode plays the first ~500ms at the wrong rate
    // (chipmunk effect). Resampling here means the buffer always matches the
    // context rate exactly — no implicit resampler involved.
    const samples =
      ctx.sampleRate === OUTPUT_SAMPLE_RATE
        ? raw
        : resampleLinear(raw, OUTPUT_SAMPLE_RATE, ctx.sampleRate);

    const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    buffer.getChannelData(0).set(samples);
    scheduleBuffer(buffer, gain);
  }, [scheduleBuffer]);

  const decodeAndEnqueue = useCallback(async (arrayBuffer: ArrayBuffer, gain = 1): Promise<void> => {
    const ctx = getOrCreateContext();
    if (ctx.state === "suspended") await ctx.resume();
    const buffer = await ctx.decodeAudioData(arrayBuffer);
    scheduleBuffer(buffer, gain);
  }, [scheduleBuffer]);

  /** Flush all queued/playing audio — called on barge-in interrupt. */
  const flush = useCallback(() => {
    for (const src of sourcesRef.current) {
      try {
        src.stop();
        src.disconnect();
      } catch {
        // Already stopped
      }
    }
    sourcesRef.current.clear();
    queueEndRef.current = 0;
    lastAmplitudeRef.current = 0;
    useSessionStore.getState().setAudioAmplitude(0);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      flush();
      if (ctxRef.current?.state !== "closed") {
        ctxRef.current?.close();
      }
      ctxRunningSinceRef.current = null;
    };
  }, [flush]);

  const isQueueEmpty = useCallback((): boolean => {
    const ctx = ctxRef.current;
    if (!ctx || ctx.state === "closed") return true;
    return sourcesRef.current.size === 0 && queueEndRef.current <= ctx.currentTime;
  }, []);

  const getPlaybackRemainingMs = useCallback((): number => {
    const ctx = ctxRef.current;
    if (!ctx || ctx.state === "closed") return 0;
    return Math.max(0, (queueEndRef.current - ctx.currentTime) * 1000);
  }, []);

  const warmUp = useCallback(async (): Promise<void> => {
    const ctx = getOrCreateContext();
    if (ctx.state === "suspended") await ctx.resume();
    // Prime at the context's native rate. The first real 24kHz PCM chunk is
    // manually resampled below, after the device/output clock is stable.
    const samples = Math.round(ctx.sampleRate * 0.25);
    const buf = ctx.createBuffer(1, samples, ctx.sampleRate);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(analyserRef.current ?? ctx.destination);
    src.start();
  }, []);

  return {
    enqueueChunk,
    decodeAndEnqueue,
    flush,
    warmUp,
    // Eagerly initialize the AudioContext so the destination stream exists
    // before recording starts — otherwise the MediaRecorder captures video-only.
    getDestinationStream: () => {
      getOrCreateContext();
      return recordingDestRef.current?.stream ?? null;
    },
    getAudioContext: () => ctxRef.current,
    isQueueEmpty,
    getPlaybackRemainingMs,
    addInputToRecording: (stream: MediaStream): (() => void) => {
      const ctx = getOrCreateContext();
      const source = ctx.createMediaStreamSource(stream);
      // Boost the mic going into the recording mix. Raw mic levels from the browser
      // post-AGC sit around RMS 0.005-0.02 — barely audible next to the puppet's full-
      // loudness TTS. STT gets a 3× boost inside useMicCapture.ts (manual MIC_GAIN), but
      // the recording sees the raw stream; without this gain, users sound far away in
      // the saved video. The compressor below acts as a safety limiter, so the boost
      // can sit at speaking-level match (3×) without shouts clipping the AAC encoder
      // — clipped transients were the dominant "bad mic audio" artifact in saved videos.
      const RECORDING_MIC_GAIN = 3.0;
      const gain = ctx.createGain();
      gain.gain.value = RECORDING_MIC_GAIN;
      // Soft-knee limiter: transparent at conversation level, compresses the top
      // ~12 dB hard enough that a shout lands loud-but-clean instead of square-waving.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -12;
      limiter.knee.value = 10;
      limiter.ratio.value = 8;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.25;
      // Route to recording destination ONLY — not speakers — to avoid feedback.
      source.connect(gain);
      gain.connect(limiter);
      limiter.connect(recordingDestRef.current!);
      return () => {
        try { limiter.disconnect(); } catch { /* ignore */ }
        try { gain.disconnect(); } catch { /* ignore */ }
        try { source.disconnect(); } catch { /* ignore */ }
      };
    },
  };
}
