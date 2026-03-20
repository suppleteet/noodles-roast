"use client";
import { useEffect, useRef, useCallback } from "react";
import { GoogleGenAI, Modality } from "@google/genai";
import type { Session, LiveServerMessage } from "@google/genai";
import { useSessionStore } from "@/store/useSessionStore";
import type { WebcamCaptureHandle } from "./WebcamCapture";
import type { VideoRecorderHandle } from "@/components/recording/VideoRecorder";
import { useMicCapture } from "@/components/audio/useMicCapture";
import { usePcmPlayback } from "@/components/audio/usePcmPlayback";
import { float32ToBase64Pcm16 } from "@/lib/audioUtils";
import { inferMotionFromTranscript } from "@/lib/motionInference";
import {
  LIVE_MODEL,
  LIVE_VOICE_NAME,
  WEBCAM_SEND_INTERVAL_MS,
  SESSION_ROTATE_MS,
  MIC_MIME_TYPE,
} from "@/lib/liveConstants";
import { getLiveSystemPrompt } from "@/lib/livePrompts";
import type { MotionState } from "@/lib/motionStates";

interface Props {
  webcamRef: React.RefObject<WebcamCaptureHandle | null>;
  videoRecorderRef: React.RefObject<VideoRecorderHandle | null>;
  compositorStream: MediaStream | null;
}

export default function LiveSessionController({
  webcamRef,
  videoRecorderRef,
  compositorStream,
}: Props) {
  const phase = useSessionStore((s) => s.phase);
  const setPhase = useSessionStore((s) => s.setPhase);
  const burnIntensity = useSessionStore((s) => s.burnIntensity);
  const setIsSpeaking = useSessionStore((s) => s.setIsSpeaking);
  const setIsListening = useSessionStore((s) => s.setIsListening);
  const setIsUserSpeaking = useSessionStore((s) => s.setIsUserSpeaking);
  const setActiveMotionState = useSessionStore((s) => s.setActiveMotionState);
  const setTranscript = useSessionStore((s) => s.setTranscript);
  const setRecordedBlob = useSessionStore((s) => s.setRecordedBlob);
  const logTiming = useSessionStore((s) => s.logTiming);
  const setObservations = useSessionStore((s) => s.setObservations);

  const sessionRef = useRef<Session | null>(null);
  const isRunningRef = useRef(false);
  const webcamIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rotateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptAccRef = useRef(""); // accumulated output transcript
  const mixerCtxRef = useRef<AudioContext | null>(null); // for merging mic+puppet audio for recording
  const mergedStreamRef = useRef<MediaStream | null>(null);

  // Audio pipeline hooks
  const playback = usePcmPlayback();
  const mic = useMicCapture(
    useCallback((pcm: Float32Array) => {
      const session = sessionRef.current;
      if (!session || !isRunningRef.current) return;
      const base64 = float32ToBase64Pcm16(pcm);
      session.sendRealtimeInput({
        audio: { data: base64, mimeType: MIC_MIME_TYPE },
      });
    }, []),
  );

  /** Fetch ephemeral token from server */
  async function fetchToken(): Promise<string> {
    const resp = await fetch("/api/live-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ burnIntensity }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(`Token fetch failed: ${(err as { detail?: string }).detail ?? resp.status}`);
    }
    const { token } = await resp.json();
    return token;
  }

  /** Open a Gemini Live session using an ephemeral token */
  async function openSession(): Promise<Session> {
    const token = await fetchToken();
    const ai = new GoogleGenAI({
      apiKey: token,
      httpOptions: { apiVersion: "v1alpha" },
    });

    const session = await ai.live.connect({
      model: LIVE_MODEL,
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: LIVE_VOICE_NAME },
          },
        },
        systemInstruction: getLiveSystemPrompt(burnIntensity),
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
      callbacks: {
        onopen: () => {
          logTiming("live: session opened");
          setIsListening(true);
        },
        onmessage: handleMessage,
        onerror: (e) => {
          console.error("[live] WebSocket error:", e.message);
          logTiming(`live: error — ${e.message}`);
        },
        onclose: () => {
          logTiming("live: session closed");
          setIsListening(false);
        },
      },
    });

    return session;
  }

  /** Handle incoming messages from Gemini */
  function handleMessage(msg: LiveServerMessage) {
    if (!isRunningRef.current) return;

    const sc = msg.serverContent;
    if (!sc) return;

    // Audio chunks from model
    if (sc.modelTurn?.parts) {
      setIsSpeaking(true);
      for (const part of sc.modelTurn.parts) {
        if (part.inlineData?.data) {
          playback.enqueueChunk(part.inlineData.data);
        }
      }
    }

    // Model was interrupted by user speech (barge-in)
    if (sc.interrupted) {
      playback.flush();
      setIsSpeaking(false);
      setActiveMotionState("listening", 0.5);
      logTiming("live: interrupted (barge-in)");
    }

    // Model finished its turn
    if (sc.turnComplete) {
      setIsSpeaking(false);
      setActiveMotionState("idle", 0.3);
    }

    // Output transcription — drive puppet animation
    if (sc.outputTranscription?.text) {
      const text = sc.outputTranscription.text;
      transcriptAccRef.current += text;
      setTranscript(transcriptAccRef.current.slice(-200));

      const energy = useSessionStore.getState().audioAmplitude;
      const [motion, intensity] = inferMotionFromTranscript(text, energy);
      setActiveMotionState(motion as MotionState, intensity);
    }

    // Input transcription — user is speaking
    if (sc.inputTranscription?.text) {
      setIsUserSpeaking(true);
      setActiveMotionState("listening", 0.5);
      // Auto-clear after a brief delay
      setTimeout(() => {
        if (isRunningRef.current) setIsUserSpeaking(false);
      }, 500);
    }

    // Waiting for user input
    if (sc.waitingForInput) {
      setActiveMotionState("listening", 0.4);
    }

    // GoAway — session is about to end
    if (msg.goAway) {
      logTiming(`live: goAway — ${msg.goAway.timeLeft ?? "unknown"} left`);
      rotateSession();
    }
  }

  /** Start sending webcam frames at 1fps */
  function startWebcamSend() {
    stopWebcamSend();
    webcamIntervalRef.current = setInterval(() => {
      if (!isRunningRef.current || !sessionRef.current) return;
      const frame = webcamRef.current?.captureFrame();
      if (frame) {
        sessionRef.current.sendRealtimeInput({
          video: { data: frame, mimeType: "image/jpeg" },
        });
      }
    }, WEBCAM_SEND_INTERVAL_MS);
  }

  function stopWebcamSend() {
    if (webcamIntervalRef.current) {
      clearInterval(webcamIntervalRef.current);
      webcamIntervalRef.current = null;
    }
  }

  /** Seamless session rotation (audio+video sessions cap at 2 min) */
  async function rotateSession() {
    if (!isRunningRef.current) return;
    logTiming("live: rotating session");

    try {
      const oldSession = sessionRef.current;
      const newSession = await openSession();
      sessionRef.current = newSession;

      // Close old session after new one is ready
      try {
        oldSession?.close();
      } catch {
        // May already be closed
      }

      // Reset rotation timer
      scheduleRotation();

      // Send an initial webcam frame to the new session
      const frame = webcamRef.current?.captureFrame();
      if (frame) {
        newSession.sendRealtimeInput({
          video: { data: frame, mimeType: "image/jpeg" },
        });
      }
    } catch (err) {
      console.error("[live] Rotation failed:", err);
      logTiming(`live: rotation error — ${(err as Error).message}`);
    }
  }

  function scheduleRotation() {
    if (rotateTimerRef.current) clearTimeout(rotateTimerRef.current);
    rotateTimerRef.current = setTimeout(rotateSession, SESSION_ROTATE_MS);
  }

  /** Create a merged audio stream (puppet output + mic input) for recording */
  function createMergedAudioStream(): MediaStream | null {
    const puppetStream = playback.getDestinationStream();
    const micStream = mic.getStream();
    if (!puppetStream) return null;

    const ctx = new AudioContext();
    mixerCtxRef.current = ctx;
    const dest = ctx.createMediaStreamDestination();

    // Puppet audio
    const puppetSource = ctx.createMediaStreamSource(puppetStream);
    puppetSource.connect(dest);

    // Mic audio (if available)
    if (micStream) {
      const micSource = ctx.createMediaStreamSource(micStream);
      // Reduce mic volume slightly so puppet voice dominates
      const micGain = ctx.createGain();
      micGain.gain.value = 0.7;
      micSource.connect(micGain);
      micGain.connect(dest);
    }

    mergedStreamRef.current = dest.stream;
    return dest.stream;
  }

  /** Start the full live session pipeline */
  async function startLiveSession() {
    isRunningRef.current = true;
    transcriptAccRef.current = "";
    logTiming("live: starting session");

    try {
      const session = await openSession();
      sessionRef.current = session;

      // Start mic capture
      await mic.start();
      logTiming("live: mic started");

      // Start webcam frame sending
      startWebcamSend();
      logTiming("live: webcam sender started");

      // Schedule session rotation
      scheduleRotation();

      // Send first webcam frame immediately
      const frame = webcamRef.current?.captureFrame();
      if (frame) {
        session.sendRealtimeInput({
          video: { data: frame, mimeType: "image/jpeg" },
        });
        logTiming("live: initial frame sent");
      }
    } catch (err) {
      console.error("[live] Failed to start:", err);
      logTiming(`live: start error — ${(err as Error).message}`);
      useSessionStore.getState().setError(
        `Live session failed: ${(err as Error).message}. Try monologue mode.`,
      );
      setPhase("idle");
    }
  }

  /** Stop everything cleanly */
  async function stopLiveSession() {
    isRunningRef.current = false;

    // Stop timers
    stopWebcamSend();
    if (rotateTimerRef.current) clearTimeout(rotateTimerRef.current);

    // Stop mic
    mic.stop();

    // Flush playback
    playback.flush();

    // Close session
    try {
      sessionRef.current?.close();
    } catch {
      // May already be closed
    }
    sessionRef.current = null;

    // Close mixer context
    if (mixerCtxRef.current?.state !== "closed") {
      mixerCtxRef.current?.close();
    }
    mixerCtxRef.current = null;
    mergedStreamRef.current = null;

    setIsSpeaking(false);
    setIsListening(false);
    setIsUserSpeaking(false);
    setActiveMotionState("idle", 0.3);

    // Stop recording
    if (videoRecorderRef.current) {
      try {
        const blob = await videoRecorderRef.current.stop();
        setRecordedBlob(blob);
      } catch (err) {
        console.error("[live] Recording stop error:", err);
      }
    }
  }

  // Lifecycle: start/stop based on phase
  useEffect(() => {
    if (phase === "roasting") {
      // Start live session first (so mic is available), then wire recording
      startLiveSession().then(() => {
        if (videoRecorderRef.current && compositorStream && isRunningRef.current) {
          const audioStream = createMergedAudioStream() ?? playback.getDestinationStream();
          videoRecorderRef.current.start(compositorStream, audioStream);
        }
      });
    } else if (phase === "stopped") {
      stopLiveSession().then(() => setPhase("sharing"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isRunningRef.current = false;
      stopWebcamSend();
      if (rotateTimerRef.current) clearTimeout(rotateTimerRef.current);
      mic.stop();
      playback.flush();
      try {
        sessionRef.current?.close();
      } catch {
        // noop
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
