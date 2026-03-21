"use client";
import { useEffect, useRef, useCallback } from "react";
import { useSessionStore } from "@/store/useSessionStore";
import type { WebcamCaptureHandle } from "./WebcamCapture";
import type { AudioPlayerHandle } from "@/components/audio/AudioPlayer";
import type { VideoRecorderHandle } from "@/components/recording/VideoRecorder";
import { ROAST_PAUSE_MS, getCannedGreeting } from "@/lib/constants";
import type { MotionState } from "@/lib/motionStates";
import type { RoastSentence } from "@/store/useSessionStore";

const IDLE_MOTION: [MotionState, number] = ["idle", 0.3];

interface Props {
  webcamRef: React.RefObject<WebcamCaptureHandle | null>;
  audioPlayerRef: React.RefObject<AudioPlayerHandle | null>;
  videoRecorderRef: React.RefObject<VideoRecorderHandle | null>;
  compositorStream: MediaStream | null;
}

export default function SessionController({
  webcamRef,
  audioPlayerRef,
  videoRecorderRef,
  compositorStream,
}: Props) {
  const phase = useSessionStore((s) => s.phase);
  const setPhase = useSessionStore((s) => s.setPhase);
  const setIsSpeaking = useSessionStore((s) => s.setIsSpeaking);
  const setActiveMotionState = useSessionStore((s) => s.setActiveMotionState);
  const setRecordedBlob = useSessionStore((s) => s.setRecordedBlob);
  const burnIntensity = useSessionStore((s) => s.burnIntensity);
  const activePersona = useSessionStore((s) => s.activePersona);
  const logTiming = useSessionStore((s) => s.logTiming);
  const clearTimingLog = useSessionStore((s) => s.clearTimingLog);
  const setObservations = useSessionStore((s) => s.setObservations);

  const isRunningRef = useRef(false);
  const loopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const cycleRef = useRef(0);

  function ts(label: string, ms: number, cycle: number) {
    logTiming(`[${cycle}] ${label}: ${ms}ms`);
  }

  /** Fetch TTS audio bytes for a single sentence */
  async function fetchTTSBuffer(text: string, signal: AbortSignal): Promise<ArrayBuffer | null> {
    try {
      const resp = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal,
      });
      if (!resp.ok) return null;
      return await resp.arrayBuffer();
    } catch (err) {
      if ((err as Error).name !== "AbortError") console.error("[session] TTS error:", text, err);
      return null;
    }
  }

  /**
   * Play sentences with pipelined TTS — fetch sentence[i+1] audio while sentence[i] is playing.
   */
  async function playSentencesPipelined(
    sentences: RoastSentence[],
    signal: AbortSignal,
    cycle: number
  ) {
    const audioPlayer = audioPlayerRef.current;
    if (!audioPlayer || !sentences.length) return;

    setIsSpeaking(true);
    let nextBufferPromise: Promise<ArrayBuffer | null> = fetchTTSBuffer(sentences[0].text, signal);

    for (let i = 0; i < sentences.length; i++) {
      if (!isRunningRef.current || signal.aborted) break;

      setActiveMotionState(sentences[i].motion as MotionState, sentences[i].intensity ?? 0.7);

      const nextFetch =
        i + 1 < sentences.length
          ? fetchTTSBuffer(sentences[i + 1].text, signal)
          : Promise.resolve(null);

      const t0 = Date.now();
      const buffer = await nextBufferPromise;
      ts(`  tts[${i}] ready`, Date.now() - t0, cycle);
      nextBufferPromise = nextFetch;

      if (buffer && isRunningRef.current && !signal.aborted) {
        const tp = Date.now();
        await audioPlayer.playBuffer(buffer);
        ts(`  play[${i}]`, Date.now() - tp, cycle);
      }
    }

    setActiveMotionState(...IDLE_MOTION);
    setIsSpeaking(false);
  }

  /** Single combined vision+roast API call */
  async function analyze(
    imageBase64: string,
    mode: "greeting" | "roast",
    signal: AbortSignal
  ): Promise<RoastSentence[]> {
    const resp = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64, burnIntensity, mode, persona: activePersona }),
      signal,
    });
    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}));
      throw new Error(`Analyze API ${resp.status}: ${(errData as { detail?: string }).detail ?? "unknown"}`);
    }
    const data = await resp.json();
    if (data.observations?.length) setObservations(data.observations);
    return data.sentences ?? [];
  }

  /** Wait until webcam has a frame */
  async function waitForFrame(signal: AbortSignal): Promise<string | null> {
    let frame = webcamRef.current?.captureFrame();
    while (!frame && isRunningRef.current && !signal.aborted) {
      await new Promise((r) => setTimeout(r, 200));
      frame = webcamRef.current?.captureFrame();
    }
    return frame ?? null;
  }

  const runRoastCycle = useCallback(async () => {
    if (!isRunningRef.current) return;

    abortControllerRef.current?.abort();
    const abort = new AbortController();
    abortControllerRef.current = abort;
    const { signal } = abort;

    const cycle = ++cycleRef.current;
    const cycleStart = Date.now();
    logTiming(`── cycle ${cycle} start ──`);

    try {
      const t0 = Date.now();
      const frame = await waitForFrame(signal);
      ts("frame", Date.now() - t0, cycle);
      if (!frame || !isRunningRef.current) return;

      const ta = Date.now();
      const sentences = await analyze(frame, "roast", signal);
      ts(`analyze (${sentences.length} sentences)`, Date.now() - ta, cycle);

      if (!sentences.length || !isRunningRef.current) {
        logTiming(`[${cycle}] no sentences, retrying`);
        if (isRunningRef.current) loopTimerRef.current = setTimeout(runRoastCycle, ROAST_PAUSE_MS);
        return;
      }

      await playSentencesPipelined(sentences, signal, cycle);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        console.error("[session] Roast cycle error:", err);
        logTiming(`[${cycle}] ERROR: ${(err as Error).message}`);
      }
    }

    ts("cycle total", Date.now() - cycleStart, cycle);

    if (isRunningRef.current) {
      loopTimerRef.current = setTimeout(runRoastCycle, ROAST_PAUSE_MS);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [burnIntensity]);

  async function runGreetingCycle() {
    if (!isRunningRef.current) return;

    const abort = new AbortController();
    abortControllerRef.current = abort;
    const { signal } = abort;

    const cycle = ++cycleRef.current;
    logTiming(`── greeting ${cycle} start ──`);

    try {
      const t0 = Date.now();
      const frame = await waitForFrame(signal);
      ts("frame", Date.now() - t0, cycle);
      if (!frame || !isRunningRef.current) { runRoastCycle(); return; }

      // Fire canned TTS + analyze in parallel
      const cannedText = getCannedGreeting(activePersona);
      const tParallel = Date.now();
      const [cannedBuffer, sentences] = await Promise.all([
        fetchTTSBuffer(cannedText, signal),
        analyze(frame, "greeting", signal).catch((err) => {
          if ((err as Error).name !== "AbortError") {
            console.error("[session] Greeting analyze error:", err);
            logTiming(`[${cycle}] analyze ERROR: ${(err as Error).message}`);
          }
          return [] as RoastSentence[];
        }),
      ]);
      ts(`parallel (tts+analyze)`, Date.now() - tParallel, cycle);

      if (!isRunningRef.current || signal.aborted) return;

      // Play canned line
      setIsSpeaking(true);
      setActiveMotionState("energetic", 0.8);
      if (cannedBuffer) {
        const tp = Date.now();
        await audioPlayerRef.current?.playBuffer(cannedBuffer);
        ts("play canned", Date.now() - tp, cycle);
      }

      // Play AI follow-up
      if (sentences.length && isRunningRef.current) {
        ts(`ai sentences (${sentences.length})`, 0, cycle);
        await playSentencesPipelined(sentences, signal, cycle);
      } else {
        setActiveMotionState(...IDLE_MOTION);
        setIsSpeaking(false);
        logTiming(`[${cycle}] no ai sentences after greeting`);
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        console.error("[session] Greeting error:", err);
        logTiming(`[${cycle}] ERROR: ${(err as Error).message}`);
      }
      setActiveMotionState(...IDLE_MOTION);
      setIsSpeaking(false);
    }

    if (isRunningRef.current) {
      loopTimerRef.current = setTimeout(runRoastCycle, ROAST_PAUSE_MS);
    }
  }

  function startLoop() {
    isRunningRef.current = true;
    clearTimingLog();
    cycleRef.current = 0;
    runGreetingCycle();
  }

  async function stopLoop() {
    isRunningRef.current = false;
    abortControllerRef.current?.abort();
    if (loopTimerRef.current) clearTimeout(loopTimerRef.current);
    setIsSpeaking(false);
    setActiveMotionState(...IDLE_MOTION);

    if (videoRecorderRef.current) {
      try {
        const blob = await videoRecorderRef.current.stop();
        setRecordedBlob(blob);
      } catch (err) {
        console.error("[session] Recording stop error:", err);
      }
    }
  }

  useEffect(() => {
    if (phase === "roasting") {
      if (videoRecorderRef.current && compositorStream) {
        const audioStream = audioPlayerRef.current?.getDestinationStream() ?? null;
        videoRecorderRef.current.start(compositorStream, audioStream);
      }
      startLoop();
    } else if (phase === "stopped") {
      stopLoop(); // stays at "stopped" — user can restart or share from HUD
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    return () => {
      isRunningRef.current = false;
      abortControllerRef.current?.abort();
      if (loopTimerRef.current) clearTimeout(loopTimerRef.current);
    };
  }, []);

  return null;
}
