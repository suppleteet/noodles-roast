"use client";
import { useRef, useEffect, useCallback } from "react";
import { useSessionStore } from "@/store/useSessionStore";
import { OUTPUT_SAMPLE_RATE } from "@/lib/liveConstants";
import { base64Pcm16ToFloat32 } from "@/lib/audioUtils";

const AMPLITUDE_THRESHOLD = 0.01;

export interface PcmPlaybackHandle {
  enqueueChunk(base64Pcm: string): void;
  flush(): void;
  getDestinationStream(): MediaStream | null;
  getAudioContext(): AudioContext | null;
}

/**
 * Hook that plays incoming base64-encoded PCM audio chunks from Gemini Live API.
 *
 * Schedules AudioBufferSourceNodes in sequence for gapless playback.
 * Polls amplitude via AnalyserNode for mouth sync (same pattern as AudioPlayer).
 */
export function usePcmPlayback(): PcmPlaybackHandle {
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const destRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const queueEndRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const rafRef = useRef<number>(0);
  const lastAmplitudeRef = useRef<number>(0);

  function getOrCreateContext(): AudioContext {
    let ctx = ctxRef.current;
    if (!ctx || ctx.state === "closed") {
      ctx = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
      ctxRef.current = ctx;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      const dest = ctx.createMediaStreamDestination();
      destRef.current = dest;

      analyser.connect(ctx.destination);
      analyser.connect(dest);
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

  const enqueueChunk = useCallback((base64Pcm: string) => {
    const ctx = getOrCreateContext();
    if (ctx.state === "suspended") ctx.resume();

    const float32 = base64Pcm16ToFloat32(base64Pcm);
    if (float32.length === 0) return;

    const buffer = ctx.createBuffer(1, float32.length, OUTPUT_SAMPLE_RATE);
    buffer.getChannelData(0).set(float32);

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(analyserRef.current!);

    const startTime = Math.max(ctx.currentTime, queueEndRef.current);
    src.start(startTime);
    queueEndRef.current = startTime + buffer.duration;

    sourcesRef.current.add(src);
    src.onended = () => {
      sourcesRef.current.delete(src);
    };
  }, []);

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

  return {
    enqueueChunk,
    flush,
    getDestinationStream: () => destRef.current?.stream ?? null,
    getAudioContext: () => ctxRef.current,
  };
}
