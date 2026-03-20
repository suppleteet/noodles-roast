"use client";
import { useRef, useCallback } from "react";
import { MIC_SAMPLE_RATE } from "@/lib/liveConstants";

export interface MicCaptureHandle {
  start(): Promise<void>;
  stop(): void;
  isCapturing(): boolean;
  getStream(): MediaStream | null;
}

/**
 * Hook that captures microphone audio as PCM Float32 chunks via AudioWorklet.
 *
 * @param onChunk — called on the main thread with each 100ms PCM chunk (Float32Array).
 */
export function useMicCapture(onChunk: (pcm: Float32Array) => void): MicCaptureHandle {
  const ctxRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const capturingRef = useRef(false);
  const onChunkRef = useRef(onChunk);
  onChunkRef.current = onChunk;

  const start = useCallback(async () => {
    if (capturingRef.current) return;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: { ideal: MIC_SAMPLE_RATE },
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    streamRef.current = stream;

    const ctx = new AudioContext({ sampleRate: MIC_SAMPLE_RATE });
    ctxRef.current = ctx;

    await ctx.audioWorklet.addModule("/worklets/mic-capture-processor.js");

    const source = ctx.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(ctx, "mic-capture-processor");
    workletRef.current = worklet;

    worklet.port.onmessage = (e: MessageEvent<{ pcm: Float32Array }>) => {
      onChunkRef.current(e.data.pcm);
    };

    source.connect(worklet);
    // Worklet doesn't produce output — no need to connect to destination
    capturingRef.current = true;
  }, []);

  const stop = useCallback(() => {
    capturingRef.current = false;
    workletRef.current?.disconnect();
    workletRef.current = null;

    if (ctxRef.current?.state !== "closed") {
      ctxRef.current?.close();
    }
    ctxRef.current = null;

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  return {
    start,
    stop,
    isCapturing: () => capturingRef.current,
    getStream: () => streamRef.current,
  };
}
