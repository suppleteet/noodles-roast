"use client";
import { useEffect, useRef, useImperativeHandle, forwardRef, useCallback } from "react";
import { useSessionStore } from "@/store/useSessionStore";

export interface AudioPlayerHandle {
  playBuffer(buffer: ArrayBuffer): Promise<void>;
  getAudioContext(): AudioContext | null;
  getDestinationStream(): MediaStream | null;
}

const AMPLITUDE_THRESHOLD = 0.01; // only push store update if change exceeds this

const AudioPlayer = forwardRef<AudioPlayerHandle>(function AudioPlayer(_props, ref) {
  const setAmplitude = useSessionStore((s) => s.setAudioAmplitude);
  const contextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const destRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const rafRef = useRef<number>(0);
  const queueEndRef = useRef<number>(0);
  const lastAmplitudeRef = useRef<number>(0);

  const pollAmplitude = useCallback(() => {
    const analyser = analyserRef.current;
    if (analyser) {
      const data = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(data);
      let sumSq = 0;
      for (let i = 0; i < data.length; i++) sumSq += data[i] * data[i];
      const rms = Math.min(Math.sqrt(sumSq / data.length) * 6, 1);
      // Only push store update when amplitude changes meaningfully
      if (Math.abs(rms - lastAmplitudeRef.current) >= AMPLITUDE_THRESHOLD) {
        lastAmplitudeRef.current = rms;
        setAmplitude(rms);
      }
    }
    rafRef.current = requestAnimationFrame(pollAmplitude);
  }, [setAmplitude]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(pollAmplitude);
    return () => cancelAnimationFrame(rafRef.current);
  }, [pollAmplitude]);

  function getOrCreateContext(): AudioContext {
    let ctx = contextRef.current;
    if (!ctx || ctx.state === "closed") {
      ctx = new AudioContext({ sampleRate: 44100 });
      contextRef.current = ctx;
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

  useImperativeHandle(ref, () => ({
    async playBuffer(rawBuffer: ArrayBuffer): Promise<void> {
      const ctx = getOrCreateContext();
      // Resume context if browser suspended it (autoplay policy)
      if (ctx.state === "suspended") await ctx.resume();

      return new Promise((resolve, reject) => {
        ctx.decodeAudioData(
          rawBuffer.slice(0),
          (decoded) => {
            const src = ctx.createBufferSource();
            src.buffer = decoded;
            src.connect(analyserRef.current!);
            const startTime = Math.max(ctx.currentTime, queueEndRef.current);
            src.start(startTime);
            queueEndRef.current = startTime + decoded.duration;
            src.onended = () => resolve();
          },
          reject
        );
      });
    },

    getAudioContext(): AudioContext | null {
      return contextRef.current;
    },

    getDestinationStream(): MediaStream | null {
      return destRef.current?.stream ?? null;
    },
  }));

  return null;
});

export default AudioPlayer;
