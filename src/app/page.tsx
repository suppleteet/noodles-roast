"use client";
import { useRef, useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { useSessionStore } from "@/store/useSessionStore";
import LandingScreen from "@/components/ui/LandingScreen";
import ConsentScreen from "@/components/ui/ConsentScreen";
import HUDOverlay from "@/components/ui/HUDOverlay";
import WebcamCapture, { type WebcamCaptureHandle } from "@/components/session/WebcamCapture";
import AudioPlayer, { type AudioPlayerHandle } from "@/components/audio/AudioPlayer";
import VideoRecorder, { type VideoRecorderHandle } from "@/components/recording/VideoRecorder";
import { useCompositor } from "@/components/recording/useCompositor";
import { PERSONA_IDS, PERSONA_NAMES } from "@/lib/personaMetadata";
import type { TtsChunkBuffer } from "@/lib/ttsChunkBuffer";
import { captureSquareJpegFromStream } from "@/lib/captureSquareJpegFromStream";
import { isMp4RecordingSupported } from "@/lib/mediaRecorderSupport";
import { currentMediaCaptureBlockMessage } from "@/lib/mediaCaptureSupport";
import type { JokeResponse } from "@/app/api/generate-joke/route";
import { useRigEditStore } from "@/engine/store/RigEditStore";
import { lockDevUi, unlockDevUi, useDevUnlock } from "@/lib/devUnlock";
import { preloadLiveExperienceModules } from "@/lib/preloadLiveExperience";

const ShareScreen = dynamic(() => import("@/components/ui/ShareScreen"), { ssr: false });
const DebugTimeline = dynamic(() => import("@/components/ui/DebugTimeline"), { ssr: false });
const DebugTranscript = dynamic(() => import("@/components/ui/DebugTranscript"), { ssr: false });
const LlmLogPanel = dynamic(() => import("@/components/ui/LlmLogPanel"), { ssr: false });
const PuppetScene = dynamic(() => import("@/components/puppet/PuppetScene"), { ssr: false });
const SessionController = dynamic(() => import("@/components/session/SessionController"), { ssr: false });
const LiveSessionController = dynamic(() => import("@/components/session/LiveSessionController"), { ssr: false });
const RigEditMode = dynamic(() => import("@/engine/ui/RigEditMode"), { ssr: false });

const LIVE_TOKEN_PREFETCH_MAX_AGE_MS = 2 * 60 * 1000;
const BUILD_TIMESTAMP = process.env.NEXT_PUBLIC_BUILD_TIMESTAMP ?? "local";

function formatBuildTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toISOString().slice(0, 16).replace("T", " ")}Z`;
}

const BUILD_TIMESTAMP_LABEL = formatBuildTimestamp(BUILD_TIMESTAMP);

interface DebugUsageSnapshot {
  llm: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  };
  tts: {
    calls: number;
    characters: number;
    estimatedCostUsd: number;
  };
  totalEstimatedCostUsd: number;
}

function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function formatDebugCost(value: number): string {
  if (value <= 0) return "$0.0000";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

/**
 * Top-level router — decides between edit mode and the main app.
 * Must be a separate component from MainApp so hooks are always called
 * in the same order regardless of which branch renders.
 */
export default function Home() {
  const isRigEditMode = useRigEditStore((s) => s.isEditMode);
  if (isRigEditMode) return <RigEditMode />;
  return <MainApp />;
}

function MainApp() {
  const phase = useSessionStore((s) => s.phase);
  const sessionMode = useSessionStore((s) => s.sessionMode);
  const setPhase = useSessionStore((s) => s.setPhase);
  const setError = useSessionStore((s) => s.setError);
  const logTiming = useSessionStore((s) => s.logTiming);
  const setSessionStartTs = useSessionStore((s) => s.setSessionStartTs);
  const timeToFirstSpeechMs = useSessionStore((s) => s.timeToFirstSpeechMs);
  const observations = useSessionStore((s) => s.observations);
  const lastVisionCallTs = useSessionStore((s) => s.lastVisionCallTs);
  const activePersona = useSessionStore((s) => s.activePersona);
  const setActivePersona = useSessionStore((s) => s.setActivePersona);
  const hasSpokenThisSession = useSessionStore((s) => s.hasSpokenThisSession);
  const puppetRevealed = useSessionStore((s) => s.puppetRevealed);
  const isEnding = useSessionStore((s) => s.isEnding);
  const brainState = useSessionStore((s) => s.brainState);
  const modelUnavailable = useSessionStore((s) => s.modelUnavailable);
  const setModelUnavailable = useSessionStore((s) => s.setModelUnavailable);
  const acceptModelFallback = useSessionStore((s) => s.acceptModelFallback);
  const IS_DEV = useDevUnlock();
  const [hydrated, setHydrated] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  const [mockMode, setMockMode] = useState(false);
  const [llmUsage, setLlmUsage] = useState<DebugUsageSnapshot | null>(null);
  const lastNonZeroUsageRef = useRef<DebugUsageSnapshot | null>(null);
  const mockModeRef = useRef(false); // ref so the requesting-permissions effect reads current value
  const pendingMockRestartRef = useRef(false); // set by handleMockToggle to bounce session
  // Set when the user picks "restart with a different model" — bounce
  // roasting → stopped → requesting-permissions so LiveSessionController's stop
  // runs (clean teardown) before the new-model session auto-starts.
  const pendingModelFallbackRestartRef = useRef(false);
  // Incremented when the caller elects to keep the existing call going after a
  // recoverable model failure. The live controller forwards it to the brain.
  const [modelTroubleContinueSignal, setModelTroubleContinueSignal] = useState(0);
  const [visionElapsedSecs, setVisionElapsedSecs] = useState<number | null>(null);

  const [webcamStream, setWebcamStream] = useState<MediaStream | null>(null);
  // Pre-fetched Live API token — may start on idle (conversation) so connect is faster after permission
  const tokenPromiseRef = useRef<Promise<string> | null>(null);
  const tokenPrefetchStartedAtRef = useRef<number | null>(null);
  // Pre-created comedian chat session — the longest-cold start path. Fired at
  // button press (settings are locked by then) so its latency overlaps the
  // permission dialog instead of stacking after it. Consumed by LiveSessionController.
  const comedianSessionPromiseRef = useRef<Promise<string | null> | null>(null);
  /** Vision analyze + greeting joke — starts as soon as we have a MediaStream, before phase is roasting */
  const warmupGreetingPromiseRef = useRef<Promise<JokeResponse | null> | null>(null);
  const warmupGreetingAudioRef = useRef<Promise<TtsChunkBuffer | null> | null>(null);
  /** Canned-intro opener (text + streaming TTS audio) — picked + fired at the same
   *  warmup point so the EL round-trip overlaps the permission/connect window.
   *  Promise-shaped because the greetingPrefetch module is dynamically imported. */
  const warmupCannedOpenerRef = useRef<Promise<
    import("@/lib/greetingPrefetch").CannedOpenerPrefetch | null
  > | null>(null);

  const webcamRef = useRef<WebcamCaptureHandle>(null);
  const audioPlayerRef = useRef<AudioPlayerHandle>(null);
  const videoRecorderRef = useRef<VideoRecorderHandle>(null);
  const puppetCanvasRef = useRef<HTMLCanvasElement>(null);
  const callSurfaceCanvasRef = useRef<HTMLCanvasElement>(null);
  const webcamVideoRef = useRef<HTMLVideoElement | null>(null);
  const pipVideoRef = useRef<HTMLVideoElement>(null);
  const callFrameRef = useRef<HTMLElement>(null);
  const callControlsRef = useRef<HTMLDivElement>(null);
  const endButtonRef = useRef<HTMLButtonElement>(null);

  const compositorHandle = useCompositor(
    puppetCanvasRef,
    callSurfaceCanvasRef,
    webcamVideoRef,
    callFrameRef,
    pipVideoRef,
    callControlsRef,
    endButtonRef,
  );

  useEffect(() => {
    setHydrated(true);
  }, []);

  // Keep mockModeRef in sync for stale-closure-safe reads in effects
  useEffect(() => { mockModeRef.current = mockMode; }, [mockMode]);

  /** Gemini Live ephemeral token (~5 min TTL); safe to prefetch on idle before the user taps Roast. */
  function ensureLiveTokenPrefetch(): void {
    if (sessionMode !== "conversation" || mockModeRef.current) return;
    if (getFreshLiveTokenPromise()) return;
    const { burnIntensity: bi, activePersona: ap } = useSessionStore.getState();
    tokenPrefetchStartedAtRef.current = Date.now();
    const tokenPromise = fetch("/api/live-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ burnIntensity: bi, persona: ap }),
    })
      .then((r) => r.json())
      .then((d: { token?: string }) => {
        if (!d.token) throw new Error("No token in response");
        logTiming("prefetch: token ready");
        return d.token;
      })
      .catch((e) => {
        console.warn("[token-prefetch] failed:", e);
        if (tokenPromiseRef.current === tokenPromise) {
          tokenPromiseRef.current = null;
          tokenPrefetchStartedAtRef.current = null;
        }
        throw e;
      });
    tokenPromiseRef.current = tokenPromise;
  }

  function getFreshLiveTokenPromise(): Promise<string> | null {
    const promise = tokenPromiseRef.current;
    const startedAt = tokenPrefetchStartedAtRef.current;
    if (!promise || startedAt === null) return null;
    if (Date.now() - startedAt > LIVE_TOKEN_PREFETCH_MAX_AGE_MS) {
      tokenPromiseRef.current = null;
      tokenPrefetchStartedAtRef.current = null;
      return null;
    }
    return promise;
  }

  /**
   * Startup resources are single-session. In particular, Gemini ephemeral
   * tokens must not be reused after a model-trouble restart, and a comedian
   * chat session is tied to the model selected when it was created.
   */
  function resetStartupPrefetches(): void {
    tokenPromiseRef.current = null;
    tokenPrefetchStartedAtRef.current = null;

    const abandonedSession = comedianSessionPromiseRef.current;
    comedianSessionPromiseRef.current = null;
    if (abandonedSession) {
      void abandonedSession
        .then((sessionId) => {
          if (!sessionId) return;
          return fetch("/api/comedian-session", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId }),
          });
        })
        .catch(() => {
          // Best-effort cleanup; server TTL is the final safety net.
        });
    }

    warmupGreetingPromiseRef.current = null;
    warmupGreetingAudioRef.current = null;
    warmupCannedOpenerRef.current = null;
  }

  /** Pre-create the comedian chat session at button press — settings are locked
   *  once the user taps Start, and this is the longest cold path, so firing it
   *  here overlaps it with the permission grant. Resolves to null on failure;
   *  LiveSessionController then falls back to creating one itself (or stateless). */
  function ensureComedianSessionPrefetch(): void {
    if (sessionMode !== "conversation" || mockModeRef.current) return;
    if (comedianSessionPromiseRef.current) return;
    const s = useSessionStore.getState();
    const comedianSessionPromise = fetch("/api/comedian-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        persona: s.activePersona,
        burnIntensity: s.burnIntensity,
        contentMode: s.contentMode,
        model: s.roastModel,
        experienceType: s.experienceType,
      }),
    })
      .then((r) => r.json())
      .then((d: { sessionId?: string }) => {
        if (!d.sessionId) return null;
        logTiming("prefetch: comedian session ready");
        return d.sessionId;
      })
      .catch((e) => {
        console.warn("[comedian-session-prefetch] failed:", e);
        if (comedianSessionPromiseRef.current === comedianSessionPromise) {
          comedianSessionPromiseRef.current = null;
        }
        return null;
      });
    comedianSessionPromiseRef.current = comedianSessionPromise;
  }

  /**
   * Fires immediately after the user grants permissions (post-click). Runs:
   *   - /api/prewarm-tts: warms EL DNS/TLS so the first real TTS request
   *     gets a faster WS handshake.
   *   - prefetchParallelVisionAndGreeting: vision + direct-image opening joke in
   *     parallel; returns the greeting JokeResponse.
   *   - prefetchGreetingAudio (chained off the joke): fires /api/tts-ws as
   *     soon as we have the joke text, accumulating audio chunks into a
   *     TtsChunkBuffer that the brain consumes on enterGreeting. Eliminates
   *     the sequential gap between "joke ready" and "EL handshake starting".
   */
  function startPreRoastGreetingWarmup(stream: MediaStream): void {
    if (sessionMode !== "conversation" || mockModeRef.current) {
      warmupGreetingPromiseRef.current = null;
      warmupGreetingAudioRef.current = null;
      warmupCannedOpenerRef.current = null;
      return;
    }

    // Fire-and-forget — runs a tiny real synthesis so EL's model/voice
    // cold-start is paid here, off the critical path, instead of on the first
    // session line (field-observed cold first-audio ~5s → 8s TTFS). Warm the
    // voice for the experience being started. Failure is harmless; the real
    // TTS call just pays the cold synth itself.
    {
      const exp = useSessionStore.getState().experienceType;
      const q = exp === "toast" ? "?voice=toast" : "";
      fetch(`/api/prewarm-tts${q}`, { method: "POST" }).catch(() => {});
    }
    const greetingPrefetchModulePromise = import("@/lib/greetingPrefetch");

    // Legacy canned intro experiment (roast only): the brain opens with an instant canned line, so a
    // prefetched LLM greeting would just be discarded — skip the wasted call.
    // Instead pick the canned line NOW and stream its TTS into a buffer, so the
    // EL handshake + synthesis overlaps the permission/connect window and the
    // opener plays the moment the brain enters greeting.
    {
      const s = useSessionStore.getState();
      if (s.cannedIntro && s.experienceType === "roast") {
        warmupGreetingPromiseRef.current = null;
        warmupGreetingAudioRef.current = null;
        warmupCannedOpenerRef.current = greetingPrefetchModulePromise
          .then((m) => m.prefetchCannedOpener())
          .catch(() => null);
        return;
      }
    }
    warmupCannedOpenerRef.current = null;

    warmupGreetingPromiseRef.current = (async () => {
      const { prefetchParallelVisionAndGreeting } = await greetingPrefetchModulePromise;
      const frame = await captureSquareJpegFromStream(stream);
      const s = useSessionStore.getState();
      return prefetchParallelVisionAndGreeting(frame, {
        activePersona: s.activePersona,
        burnIntensity: s.burnIntensity,
        contentMode: s.contentMode,
        visionModel: s.visionModel,
        experienceType: s.experienceType,
      });
    })().catch(() => null);

    // As soon as the joke text lands, fire EL TTS so audio chunks start
    // streaming into a buffer the brain will pick up at enterGreeting.
    warmupGreetingAudioRef.current = Promise.all([
      warmupGreetingPromiseRef.current,
      greetingPrefetchModulePromise,
    ])
      .then(([response, { prefetchGreetingAudio }]) => {
        if (!response?.jokes.length) return null;
        const joke = response.jokes[0];
        const s = useSessionStore.getState();
        return prefetchGreetingAudio(
          joke.text,
          joke.motion,
          joke.intensity,
          s.voiceSettings,
          s.experienceType,
        );
      })
      .catch(() => null);
  }

  const handleStartSession = async () => {
    preloadLiveExperienceModules();
    const captureBlockMessage = currentMediaCaptureBlockMessage();
    if (captureBlockMessage) {
      setError(captureBlockMessage);
      return;
    }
    // MP4-only flow — block the session if MediaRecorder can't produce MP4.
    // No fallback to WebM since the server can't convert it (Vercel Hobby tier
    // has no ffmpeg). Surface a clear message so the user knows to switch
    // browsers rather than seeing the session fail silently after the roast.
    if (!isMp4RecordingSupported()) {
      setError(
        "This browser can't record MP4. Please open Roastie in Chrome, Safari, or Edge.",
      );
      return;
    }
    if (process.env.NEXT_PUBLIC_ROASTIE_PAYMENTS_ENABLED === "true") {
      const resp = await fetch("/api/monetization/redeem", { method: "POST" });
      if (!resp.ok) {
        const data = (await resp.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "No Roast Pass available.");
        setPhase("sharing", "SHARE_CLICKED");
        return;
      }
    }
    setPhase("requesting-permissions", "START_CLICKED");
  };

  // Capture first frame from a MediaStream and send to vision API immediately
  function preAnalyzeFirstFrame(stream: MediaStream) {
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    video.play().then(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      // Center-crop to square before sending to vision
      const vw = video.videoWidth || 640;
      const vh = video.videoHeight || 480;
      const side = Math.min(vw, vh);
      const sx = (vw - side) / 2;
      const sy = (vh - side) / 2;
      ctx.drawImage(video, sx, sy, side, side, 0, 0, 512, 512);
      const imageBase64 = canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
      video.pause();
      video.srcObject = null;
      if (!imageBase64) return;
      const { burnIntensity: bi, activePersona: ap } = useSessionStore.getState();
      logTiming("pre-scan: frame captured, sending to vision");
      fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64, burnIntensity: bi, mode: "vision", persona: ap }),
        signal: AbortSignal.timeout(8000),
      })
        .then((r) => r.json())
        .then((d: { observations?: string[] }) => {
          if (d.observations?.length) {
            useSessionStore.getState().setObservations(d.observations);
            logTiming("pre-scan: observations ready");
          }
        })
        .catch(() => {});
    }).catch(() => {});
  }

  // Eagerly request camera as soon as the consent screen appears — this way permission
  // dialog fires while the user is reading, and the first frame is pre-analyzed.
  useEffect(() => {
    if (phase !== "consent") return;
    if (currentMediaCaptureBlockMessage()) return;
    navigator.mediaDevices
      .getUserMedia({
        video: { width: { ideal: 720 }, height: { ideal: 720 }, facingMode: { ideal: "user" } },
        audio: false, // microphone is requested together with camera at start
      })
      .then((stream) => {
        setWebcamStream(stream);
        preAnalyzeFirstFrame(stream);
      })
      .catch(() => {
        // Silently fail — requesting-permissions will retry with proper error display
      });
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const prevPhaseRef = useRef<typeof phase | null>(null);

  // Idle: clear stale prefetch handles when returning from a session, then warm the Live token for the next run
  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = phase;

    if (phase !== "idle") return;

    const enteredIdleFromSession = prev !== null && prev !== "idle";
    if (enteredIdleFromSession) {
      resetStartupPrefetches();
    }
    if (sessionMode === "conversation" && !mockMode) {
      ensureLiveTokenPrefetch();
    }
  }, [phase, sessionMode, mockMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Request camera when phase enters requesting-permissions
  useEffect(() => {
    if (phase !== "requesting-permissions") return;

    const captureBlockMessage = currentMediaCaptureBlockMessage();
    if (captureBlockMessage) {
      setError(captureBlockMessage);
      setPhase("idle", "PERMISSIONS_DENIED");
      return;
    }

    ensureLiveTokenPrefetch();
    // Kick off the longest cold path now (settings locked at button press) so it
    // overlaps the permission dialog rather than stacking after the session mounts.
    ensureComedianSessionPrefetch();

    const liveVideoTracks = webcamStream
      ?.getVideoTracks()
      .filter((track) => track.readyState === "live") ?? [];
    const liveAudioTracks = webcamStream
      ?.getAudioTracks()
      .filter((track) => track.readyState === "live") ?? [];

    // If camera + mic were already granted, go straight to warmup.
    if (webcamStream?.getAudioTracks().some((track) => track.readyState === "live")) {
      startPreRoastGreetingWarmup(webcamStream);
      setPhase("roasting", "PERMISSIONS_GRANTED");
      return;
    }

    if (webcamStream && liveVideoTracks.length > 0) {
      navigator.mediaDevices
        .getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
          },
        })
        .then((audioStream) => {
          const stream = new MediaStream([
            ...liveVideoTracks,
            ...audioStream.getAudioTracks(),
          ]);
          setWebcamStream(stream);
          startPreRoastGreetingWarmup(stream);
          setPhase("roasting", "PERMISSIONS_GRANTED");
        })
        .catch((err) => {
          console.error("Microphone denied:", err.name, err.message);
          setError(`Microphone error: ${err.name} — ${err.message}. Please allow microphone access and try again.`);
          setPhase("idle", "PERMISSIONS_DENIED");
        });
      return;
    }

    // Request camera and microphone together before the session starts. Splitting
    // this into a later background mic request can leave the live session deaf.
    navigator.mediaDevices
      .getUserMedia({
        video: { width: { ideal: 720 }, height: { ideal: 720 }, facingMode: { ideal: "user" } },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      })
      .then((stream) => {
        liveAudioTracks.forEach((track) => track.stop());
        setWebcamStream(stream);
        startPreRoastGreetingWarmup(stream);
        setPhase("roasting", "PERMISSIONS_GRANTED");
      })
      .catch((err) => {
        console.error("Camera/microphone denied:", err.name, err.message);
        setError(`Camera/microphone error: ${err.name} — ${err.message}. Please allow both camera and microphone access and try again.`);
        setPhase("idle", "PERMISSIONS_DENIED");
      });
  }, [phase, sessionMode, webcamStream, setPhase, setError]); // eslint-disable-line react-hooks/exhaustive-deps

  // Wire webcam video element ref once stream is ready
  useEffect(() => {
    webcamVideoRef.current = webcamRef.current?.getVideoElement() ?? null;
  }, [webcamStream]);

  // Wire PIP video element to webcam stream.
  // useCallback ref so it re-fires when the element mounts/unmounts (showPuppet toggles DOM).
  const pipRefCallback = useCallback((el: HTMLVideoElement | null) => {
    pipVideoRef.current = el;
    if (!el) return;
    el.srcObject = webcamStream;
    if (webcamStream) el.play().catch(() => {});
  }, [webcamStream]); // eslint-disable-line react-hooks/exhaustive-deps

  // Also sync stream to already-mounted element when webcamStream changes
  useEffect(() => {
    if (!pipVideoRef.current) return;
    pipVideoRef.current.srcObject = webcamStream;
    if (webcamStream) pipVideoRef.current.play().catch(() => {});
  }, [webcamStream]);

  // Start session timer + clear stale logs when roasting begins;
  // save log to disk when session stops.
  useEffect(() => {
    if (phase === "roasting") {
      const now = Date.now();
      setSessionStartTs(now);
      // NOTE: Do NOT clearTimingLog() here — startLiveSession() already logged
      // prefetch entries before this effect runs. Clearing would wipe them.
      logTiming("session: roasting started");
    }
    if (phase === "stopped" || phase === "sharing") {
      const s = useSessionStore.getState();
      fetch("/api/save-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trigger: phase,
          sessionStartTs: s.sessionStartTs,
          timingLog: s.timingLog,
          transcriptHistory: s.transcriptHistory,
          laughCount: s.laughCount,
          smileFrames: s.smileFrames,
          totalVisionFrames: s.totalVisionFrames,
          timeToFirstSpeechMs: s.timeToFirstSpeechMs,
          activePersona: s.activePersona,
          burnIntensity: s.burnIntensity,
        }),
      }).catch(() => {});
    }
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stop webcam tracks after recording shutdown has had a chance to capture the final blob.
  // `stopped` is an intermediate phase where LiveSessionController.stopLiveSession()
  // is still stopping MediaRecorder; killing tracks here can produce an empty share screen.
  useEffect(() => {
    if ((phase === "sharing" || phase === "idle") && webcamStream) {
      webcamStream.getTracks().forEach((t) => t.stop());
      setWebcamStream(null);
    }
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (lastVisionCallTs === null) { setVisionElapsedSecs(null); return; }
    const tick = () => setVisionElapsedSecs(Math.floor((Date.now() - lastVisionCallTs) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lastVisionCallTs]);

  useEffect(() => {
    if (!IS_DEV || !debugMode) return;
    let cancelled = false;

    async function refreshUsage() {
      const resp = await fetch("/api/debug-usage", { cache: "no-store" }).catch(() => null);
      if (!resp?.ok) return;
      const data = (await resp.json()) as DebugUsageSnapshot;
      const hasUsage = data.totalEstimatedCostUsd > 0 || data.llm.calls > 0 || data.tts.calls > 0;
      if (hasUsage) lastNonZeroUsageRef.current = data;
      if (!cancelled) setLlmUsage(hasUsage ? data : lastNonZeroUsageRef.current ?? data);
    }

    void refreshUsage();
    const id = window.setInterval(refreshUsage, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [IS_DEV, debugMode]);

  const showPuppet =
    phase === "roasting" || phase === "stopped" || phase === "requesting-permissions";

  function handleDebugToggle(checked: boolean) {
    setDebugMode(checked);
    if (!checked) {
      setMockMode(false);
      mockModeRef.current = false;
      lockDevUi();
      setPhase("idle", "DEBUG_TOGGLE");
    }
  }

  function handleBuildTimestampClick() {
    unlockDevUi();
    setDebugMode(true);
  }

  function handleMockToggle(checked: boolean) {
    setMockMode(checked);
    mockModeRef.current = checked;
    // If a session is running, bounce through stopped → requesting-permissions.
    // Child effects (LiveSessionController stopLiveSession) fire before parent
    // effects, so by the time the phase==="stopped" effect below runs, the
    // session is already torn down.
    if (phase === "roasting" || phase === "stopped") {
      pendingMockRestartRef.current = true;
      setPhase("stopped", "STOP_CLICKED");
    }
  }

  // Bounce-on-stopped handlers. The two pending refs are mutually exclusive by
  // construction — each is set by exactly one caller (mock toggle / modal restart)
  // that never sets the other, so their order here doesn't race.
  useEffect(() => {
    if (phase === "stopped" && pendingMockRestartRef.current) {
      pendingMockRestartRef.current = false;
      resetStartupPrefetches();
      setPhase("requesting-permissions", "SESSION_RESTART");
    }
    if (phase === "stopped" && pendingModelFallbackRestartRef.current) {
      pendingModelFallbackRestartRef.current = false;
      resetStartupPrefetches();
      // Auto-restart with the already-swapped model (running synchronously here
      // beats LiveSessionController.stopLiveSession's async share navigation).
      setPhase("requesting-permissions", "SESSION_RESTART");
    }
  }, [phase]);

  return (
    <main className="call-app">
      <button
        type="button"
        onClick={handleBuildTimestampClick}
        disabled={!hydrated}
        data-testid="build-timestamp"
        aria-label="Open developer tools"
        title={`Build ${BUILD_TIMESTAMP}`}
        className="fixed bottom-2 right-3 z-[70] rounded px-1.5 py-1 font-mono text-[9px] text-white/25 transition-colors hover:bg-white/5 hover:text-white/65 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/50 md:text-[10px]"
      >
        {BUILD_TIMESTAMP_LABEL}
      </button>
      {/* Debug / mock toggles — dev only */}
      {IS_DEV && (
        <div className="absolute top-3 right-3 z-50 flex items-center gap-3 text-white/50 text-xs select-none">
          {debugMode && (
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={mockMode}
                onChange={(e) => handleMockToggle(e.target.checked)}
                className="accent-orange-400"
              />
              mock
            </label>
          )}
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={debugMode}
              onChange={(e) => handleDebugToggle(e.target.checked)}
              className="accent-yellow-400"
            />
            debug
          </label>
          <button
            onClick={() => useRigEditStore.getState().enterEditMode()}
            className="text-white/50 hover:text-white/80 border border-white/20 rounded px-2 py-0.5 text-xs transition-colors"
          >
            Edit Rig
          </button>
        </div>
      )}
      <AudioPlayer ref={audioPlayerRef} />
      <VideoRecorder ref={videoRecorderRef} />
      <WebcamCapture ref={webcamRef} stream={webcamStream} />

      {phase === "roasting" && sessionMode === "monologue" && (
        <SessionController
          webcamRef={webcamRef}
          audioPlayerRef={audioPlayerRef}
          videoRecorderRef={videoRecorderRef}
          compositorHandle={compositorHandle}
        />
      )}

      {(phase === "roasting" || phase === "stopped") && sessionMode === "conversation" && (
        <LiveSessionController
          webcamRef={webcamRef}
          videoRecorderRef={videoRecorderRef}
          compositorHandle={compositorHandle}
          mediaStream={webcamStream}
          prefetchedTokenPromise={getFreshLiveTokenPromise()}
          prefetchedComedianSessionPromise={comedianSessionPromiseRef.current}
          warmupGreetingPrefetch={warmupGreetingPromiseRef.current}
          warmupGreetingAudio={warmupGreetingAudioRef.current}
          warmupCannedOpener={warmupCannedOpenerRef.current}
          modelTroubleContinueSignal={modelTroubleContinueSignal}
          mockMode={mockMode}
        />
      )}

      <section
        ref={callFrameRef}
        data-testid="call-frame"
        aria-label="Puppet Line call"
        className="call-frame"
      >
        {phase === "idle" && <LandingScreen />}
        {phase === "consent" && <ConsentScreen />}

        {showPuppet && (
        <div data-testid="call-surface" className="call-puppet-stage">
          {/* Loading overlay — fades out only when the first TTS audio chunk starts. */}
          <div className={`absolute inset-0 bg-black z-10 pointer-events-none transition-opacity ${isEnding ? "duration-[600ms]" : "duration-[500ms]"} ${puppetRevealed ? "opacity-0" : "opacity-100"}`}>
            {(phase === "requesting-permissions" || phase === "roasting") && !puppetRevealed && (
              <div className="flex items-center justify-center h-full">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <p className="text-white/50 text-sm font-medium animate-pulse" aria-label="Connecting.">
                    Connecting<span className="loading-ellipsis" aria-hidden="true" />
                  </p>
                </div>
              </div>
            )}
          </div>
          <PuppetScene canvasRef={puppetCanvasRef} />
          {/* Webcam PIP — responsive top-right, mirrored; hidden once stream stops */}
          <video
            ref={pipRefCallback}
            muted
            playsInline
            data-testid="self-view"
            aria-label="Your camera preview"
            className={`call-self-view ${webcamStream ? "" : "hidden"}`}
            style={{ transform: "scaleX(-1)" }}
          />
          {(phase === "roasting" || phase === "stopped") && (
            <HUDOverlay
              onStartSession={handleStartSession}
              isMock={mockMode}
            />
          )}
        </div>
        )}

        <canvas
          ref={callSurfaceCanvasRef}
          data-testid="recorded-call-surface"
          aria-hidden="true"
          className={`call-recording-surface ${
            phase === "roasting" &&
            (sessionMode === "monologue" || puppetRevealed || isEnding)
              ? "call-recording-surface--active"
              : ""
          }`}
        />

        {phase === "roasting" && (
          <div ref={callControlsRef} data-testid="call-controls" className="call-controls">
            <button
              ref={endButtonRef}
              type="button"
              onClick={() => setPhase("stopped", "STOP_CLICKED")}
              aria-label="End Session"
              className="call-end-button"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path
                  transform="rotate(90 12 12)"
                  d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.08 4.18 2 2 0 0 1 4.06 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.78.62 2.63a2 2 0 0 1-.45 2.11L7.96 9.72a16 16 0 0 0 6 6l1.26-1.26a2 2 0 0 1 2.11-.45c.85.29 1.73.5 2.63.62A2 2 0 0 1 22 16.92Z"
                />
              </svg>
              <span className="sr-only">End Session</span>
            </button>
            <span className="call-control-label">End</span>
          </div>
        )}

        {phase === "sharing" && <ShareScreen />}
      </section>

      {/* Debug panels — dev only */}
      {IS_DEV && debugMode && <DebugTranscript />}
      {IS_DEV && debugMode && <DebugTimeline />}
      {IS_DEV && debugMode && (
        <div className="fixed top-3 bottom-20 left-3 z-50 flex flex-col gap-2 max-w-xs">
          {/* Persona selector */}
          <div className="bg-black/80 border border-purple-400/40 rounded p-2 font-mono text-[10px] text-purple-300 leading-tight pointer-events-auto">
            <div className="text-purple-500 mb-1">persona</div>
            <select
              value={activePersona}
              onChange={(e) => setActivePersona(e.target.value as typeof activePersona)}
              className="bg-black/60 border border-purple-400/30 rounded text-purple-200 text-[10px] w-full px-1 py-0.5 cursor-pointer"
            >
              {PERSONA_IDS.map((id) => (
                <option key={id} value={id}>{PERSONA_NAMES[id]} ({id})</option>
              ))}
            </select>
          </div>
          {/* Time to first speech */}
          <div className="bg-black/80 border border-orange-400/40 rounded p-2 font-mono text-[10px] leading-tight pointer-events-auto">
            <span className="text-orange-500">TTFS </span>
            {timeToFirstSpeechMs !== null ? (
              <span className={`font-bold ${timeToFirstSpeechMs < 1500 ? "text-green-400" : timeToFirstSpeechMs < 3000 ? "text-yellow-400" : "text-red-400"}`}>
                {timeToFirstSpeechMs}ms
              </span>
            ) : (
              <span className="text-white/30">{phase === "roasting" ? "waiting…" : "—"}</span>
            )}
          </div>
          {observations.length > 0 && (
            <div className="bg-black/80 border border-cyan-400/40 rounded p-2 font-mono text-[10px] text-cyan-300 leading-tight pointer-events-auto overflow-y-auto max-h-36">
              <div className="text-cyan-500 mb-1">vision{visionElapsedSecs !== null ? ` · ${visionElapsedSecs}s ago` : ""}</div>
              {observations.map((obs, i) => (
                <div key={i}>· {obs}</div>
              ))}
            </div>
          )}
          {llmUsage && (
            <div className="bg-black/80 border border-emerald-400/40 rounded p-2 font-mono text-[10px] leading-tight pointer-events-auto">
              <div className="text-[11px]">
                <span className="text-emerald-400">COST </span>
                <span className="font-bold text-emerald-100">{formatDebugCost(llmUsage.totalEstimatedCostUsd)}</span>
                <span className="text-white/35"> est</span>
              </div>
              <div className="text-white/35">
                {llmUsage.llm.calls + llmUsage.tts.calls} calls · {formatCompactNumber(llmUsage.llm.totalTokens)} tok · {formatCompactNumber(llmUsage.tts.characters)} chars
              </div>
              <div className="text-white/25">
                LLM {formatDebugCost(llmUsage.llm.estimatedCostUsd)} · TTS {formatDebugCost(llmUsage.tts.estimatedCostUsd)}
              </div>
            </div>
          )}
          <LlmLogPanel />
        </div>
      )}
      {modelUnavailable && (
        <ModelFallbackPrompt
          suggestedFallback={modelUnavailable.suggestedFallback}
          onAccept={() => {
            // Swap to the suggested model and restart the session with it.
            acceptModelFallback();
            resetStartupPrefetches();
            if (phase === "roasting") {
              // Bounce roasting → stopped (LiveSessionController teardown) →
              // requesting-permissions (effect above auto-restarts on new model).
              pendingModelFallbackRestartRef.current = true;
              setPhase("stopped", "STOP_CLICKED");
            } else {
              // Session already torn down behind the modal (idle/stopped) — start fresh.
              setPhase("requesting-permissions", "SESSION_RESTART");
            }
          }}
          onContinue={() => {
            // Keep the current live session and let the brain abandon its
            // technical-exit line. This deliberately does not change phase or
            // create a new session.
            setModelUnavailable(null);
            setModelTroubleContinueSignal((signal) => signal + 1);
          }}
        />
      )}
    </main>
  );
}

function ModelFallbackPrompt({
  suggestedFallback,
  onAccept,
  onContinue,
}: {
  suggestedFallback: string;
  onAccept: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-6">
      <div className="w-full max-w-md rounded-2xl border border-orange-300/30 bg-gray-950 p-6 shadow-2xl">
        <h2 className="mb-3 text-lg font-bold text-orange-200">His brain glitched out</h2>
        <p className="mb-5 text-sm text-white/80">
          The comedian&apos;s brain froze up. Start over with a different model
          (<span className="font-mono text-orange-200">{suggestedFallback}</span>), or
          continue this call and try the current one again.
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onAccept}
            className="flex-1 rounded-xl bg-orange-500 px-4 py-2 font-bold text-black transition-colors hover:bg-orange-400"
          >
            Start Over
          </button>
          <button
            type="button"
            onClick={onContinue}
            className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 font-medium text-white/80 transition-colors hover:bg-white/10"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
