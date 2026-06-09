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
  /** Call synchronously from a user gesture (tap/click) to create and warm the
   *  AudioContext. On iOS Safari this is required for hardware volume buttons
   *  to control Web Audio output. */
  warmUp(): void;
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

export function usePcmPlayback(): PcmPlaybackHandle {
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recordingDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const playbackDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const queueEndRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const rafRef = useRef<number>(0);
  const lastAmplitudeRef = useRef<number>(0);

  function getOrCreateContext(): AudioContext {
    let ctx = ctxRef.current;
    if (!ctx || ctx.state === "closed") {
      // Use device native sample rate (don't request 24kHz). iOS Safari sometimes
      // honors the request, sometimes coerces silently to 48kHz, and on the latter
      // path its built-in AudioBufferSourceNode resampler glitches the first ~500ms
      // of audio (chipmunk effect). Resampling ourselves in enqueueChunk gives a
      // single deterministic code path on every device.
      ctx = new AudioContext({ latencyHint: "playback" });
      ctxRef.current = ctx;

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

      // PLAYBACK: analyser → masterGain → playbackDest → <audio> element →
      // device speakers.
      //
      // Why the <audio> indirection: ctx.destination alone does NOT reliably
      // attach to the Android Chrome MEDIA volume widget. On many devices it
      // routes outside the OS mixer entirely — hardware volume buttons don't
      // affect it, and OS volume=0 still leaks audio through. Routing through
      // a MediaStream into an <audio> element puts the playback path under the
      // OS mixer (MEDIA stream), so the volume buttons control it AND zero
      // means zero. masterGain caps Toast's hot peaks at ≈ −3 dB so loud lines
      // don't blow out.
      const masterGain = ctx.createGain();
      masterGain.gain.value = MASTER_PLAYBACK_GAIN;
      masterGainRef.current = masterGain;
      const playbackDest = ctx.createMediaStreamDestination();
      playbackDestRef.current = playbackDest;
      analyser.connect(masterGain);
      masterGain.connect(playbackDest);

      // Mount the playback <audio> element. Imperative + appended to body so
      // it survives any conditional rendering; the OS volume widget needs an
      // element it can see in the DOM to bind controls to.
      //
      // ANDROID GOTCHA: <audio srcObject={mediaStream}> + autoplay only works
      // reliably when (a) the stream isn't silent at srcObject-set time, and
      // (b) play() is called inside a user gesture. warmUp() runs from
      // startLiveSession() which is in an async effect — no gesture context.
      // So we do two things:
      //   1. Prime the stream with a 50ms silent buffer BEFORE setting
      //      srcObject, so the MediaStream has data flowing when the audio
      //      element binds to it.
      //   2. If play() rejects, register a one-time pointerdown listener that
      //      retries play() on the next user tap. The user's first tap is
      //      almost always within a second of the puppet appearing anyway.
      if (typeof document !== "undefined") {
        let el = audioElRef.current;
        if (!el) {
          el = document.createElement("audio");
          el.autoplay = true;
          // playsInline isn't on the HTMLAudioElement type (it's HTMLVideoElement),
          // but Android browsers respect the attribute on <audio> too — set it
          // via setAttribute so it sticks without a type cast.
          el.setAttribute("playsinline", "");
          // Keep it out of the visual flow — but in the DOM so OS mixer sees it.
          el.style.position = "fixed";
          el.style.width = "0";
          el.style.height = "0";
          el.style.opacity = "0";
          el.style.pointerEvents = "none";
          // Don't show a default controls UI even if devtools force-shows it.
          el.controls = false;
          document.body.appendChild(el);
          audioElRef.current = el;
        }
        // (1) Prime the stream with 50ms of silence — analyser → masterGain →
        // playbackDest now has data flowing before the <audio> element binds.
        // Without this, Chrome Android sees an empty MediaStream and pauses
        // the audio element until "data arrives", which it then can't auto-
        // resume from outside a user gesture.
        try {
          const primeBuf = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.05), ctx.sampleRate);
          const primeSrc = ctx.createBufferSource();
          primeSrc.buffer = primeBuf;
          primeSrc.connect(analyser);
          primeSrc.start();
        } catch { /* createBufferSource shouldn't fail; ignore if it does */ }

        el.srcObject = playbackDest.stream;

        // (2) Try play(). If it rejects (no gesture), arm a one-shot retry on
        // the next pointerdown anywhere on the page so the user's first tap
        // (or the next button press) wakes the element.
        el.play().catch(() => {
          const audioEl = el!;
          const retry = () => {
            void audioEl.play().catch(() => { /* still gated, give up */ });
            window.removeEventListener("pointerdown", retry);
            window.removeEventListener("touchstart", retry);
          };
          window.addEventListener("pointerdown", retry, { once: true, passive: true });
          window.addEventListener("touchstart", retry, { once: true, passive: true });
        });
      }
    }
    return ctx;
  }

  // Amplitude polling — drives puppet mouth sync via store
  const pollAmplitude = useCallback(() => {
    const analyser = analyserRef.current;
    if (analyser) {
      const data = new Float32Array(analyser.fftSize);
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

  const warmUp = useCallback(() => {
    const ctx = getOrCreateContext();
    if (ctx.state === "suspended") ctx.resume();
    // 250ms of silence at OUTPUT_SAMPLE_RATE: marks the context as user-initiated
    // media (so iOS hardware volume buttons control it) AND warms the resampler
    // before real audio arrives. Without the latter, iOS Safari plays the first
    // ~500ms of real chunks at the context's native rate (chipmunk effect) before
    // the 24kHz→48kHz resampler stabilizes.
    const samples = Math.round(OUTPUT_SAMPLE_RATE * 0.25);
    const buf = ctx.createBuffer(1, samples, OUTPUT_SAMPLE_RATE);
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
      // the saved video. 2.5× is the safe ceiling — high enough to match speaking
      // levels in the recording without clipping when the user shouts.
      const RECORDING_MIC_GAIN = 2.5;
      const gain = ctx.createGain();
      gain.gain.value = RECORDING_MIC_GAIN;
      // Route to recording destination ONLY — not speakers — to avoid feedback.
      source.connect(gain);
      gain.connect(recordingDestRef.current!);
      return () => {
        try { gain.disconnect(); } catch { /* ignore */ }
        try { source.disconnect(); } catch { /* ignore */ }
      };
    },
  };
}
