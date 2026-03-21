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
  VISION_INTERVAL_MS,
  SESSION_ROTATE_MS,
  MIC_MIME_TYPE,
  MOCK_LINES,
} from "@/lib/liveConstants";
import { getLiveSystemPrompt } from "@/lib/livePrompts";
import type { MotionState } from "@/lib/motionStates";


interface Props {
  webcamRef: React.RefObject<WebcamCaptureHandle | null>;
  videoRecorderRef: React.RefObject<VideoRecorderHandle | null>;
  compositorStream: MediaStream | null;
  prefetchedTokenPromise?: Promise<string> | null;
  mockMode?: boolean;
}

export default function LiveSessionController({
  webcamRef,
  videoRecorderRef,
  compositorStream,
  prefetchedTokenPromise,
  mockMode = false,
}: Props) {
  // Only subscribe to phase for lifecycle — all other store access uses getState()
  // to avoid stale closures in long-lived WebSocket callbacks.
  const phase = useSessionStore((s) => s.phase);

  const sessionRef = useRef<Session | null>(null);
  const isRunningRef = useRef(false);
  const webcamIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const visionIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rotateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userSpeakingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptAccRef = useRef(""); // accumulated output transcript
  const mixerCtxRef = useRef<AudioContext | null>(null); // for merging mic+puppet audio for recording
  const mergedStreamRef = useRef<MediaStream | null>(null);
  const kickoffTimeRef = useRef<number | null>(null); // wall-clock ms when kickoff was sent
  const firstSpeechRecordedRef = useRef(false); // guard — only record TTFS once per session

  // Timeline span IDs — track open spans so we can close them at the right moment
  const userSpeakingSpanRef = useRef<string | null>(null);
  const geminiWaitingSpanRef = useRef<string | null>(null);
  const geminiSpeakingSpanRef = useRef<string | null>(null);

  // TTS pipeline — text buffering and sequential ElevenLabs requests
  const textBufferRef = useRef(""); // text fragments from Gemini, flushed at sentence boundaries
  const ttsChainRef = useRef<Promise<void>>(Promise.resolve()); // sequential TTS queue
  const ttsGenerationRef = useRef(0); // incremented on barge-in to invalidate in-flight TTS

  // Audio pipeline hooks
  const playback = usePcmPlayback();
  const mic = useMicCapture(
    useCallback((pcm: Float32Array) => {
      const session = sessionRef.current;
      if (!session || !isRunningRef.current) return;
      const base64 = float32ToBase64Pcm16(pcm);
      try {
        session.sendRealtimeInput({
          audio: { data: base64, mimeType: MIC_MIME_TYPE },
        });
      } catch {
        // Session WebSocket may be in CLOSING state during rotation — safe to discard chunk
      }
    }, []),
  );

  /** Fetch ephemeral token from server — reads current values from store to avoid stale closures */
  async function fetchToken(): Promise<string> {
    const { burnIntensity: bi, activePersona: ap } = useSessionStore.getState();
    const resp = await fetch("/api/live-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ burnIntensity: bi, persona: ap }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(`Token fetch failed: ${(err as { detail?: string }).detail ?? resp.status}`);
    }
    const { token } = await resp.json();
    return token;
  }

  /** Open a Gemini Live session — uses pre-fetched token for initial connect (faster TTFS) */
  async function openSession(tokenPromise?: Promise<string> | null): Promise<Session> {
    const { burnIntensity: bi, activePersona: ap } = useSessionStore.getState();
    const token = tokenPromise ? await tokenPromise.catch(() => fetchToken()) : await fetchToken();
    const ai = new GoogleGenAI({
      apiKey: token,
      httpOptions: { apiVersion: "v1alpha" },
    });

    const session = await ai.live.connect({
      model: LIVE_MODEL,
      config: {
        // AUDIO mode — keeps native VAD and turn detection working reliably.
        // We discard Gemini's audio and route outputAudioTranscription to ElevenLabs instead,
        // so we get full ElevenLabs voice styling without breaking the conversation engine.
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: LIVE_VOICE_NAME } },
        },
        systemInstruction: getLiveSystemPrompt(bi, ap),
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
      callbacks: {
        onopen: () => {
          useSessionStore.getState().logTiming("live: session opened");
          useSessionStore.getState().setIsListening(true);
        },
        onmessage: handleMessage,
        onerror: (e) => {
          const msg = e instanceof ErrorEvent ? e.message : String(e);
          console.error("[live] WebSocket error:", msg);
          useSessionStore.getState().logTiming(`live: error — ${msg}`);
        },
        onclose: () => {
          useSessionStore.getState().logTiming("live: session closed");
          useSessionStore.getState().setIsListening(false);
        },
      },
    });

    return session;
  }

  /**
   * Split buffered text at sentence boundaries.
   * Returns complete sentences and whatever remains (possibly mid-sentence).
   */
  function extractSentences(text: string): [complete: string[], remainder: string] {
    const parts = text.split(/(?<=[.!?])\s+/);
    if (parts.length <= 1) {
      // No split — check if entire string ends in punctuation (e.g. last sentence of turn)
      return text.match(/[.!?]$/) ? [[text], ""] : [[], text];
    }
    const remainder = parts.pop()!;
    return [parts, remainder];
  }

  /**
   * Fetch ElevenLabs TTS for one text chunk and schedule playback.
   * Bails out if `generation` no longer matches (barge-in happened).
   */
  async function speakText(text: string, generation: number): Promise<void> {
    if (!text.trim() || !isRunningRef.current) return;
    try {
      const ttsSpanId = useSessionStore.getState().beginSpan("tts", text.trim().slice(0, 22));
      const resp = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim() }),
      });
      useSessionStore.getState().endSpan(ttsSpanId);
      if (!resp.ok || !isRunningRef.current || ttsGenerationRef.current !== generation) return;

      const ab = await resp.arrayBuffer();
      if (!isRunningRef.current || ttsGenerationRef.current !== generation) return;

      await playback.decodeAndEnqueue(ab);

      // If barge-in happened during decode, flush the buffer we just queued
      if (ttsGenerationRef.current !== generation) {
        playback.flush();
        return;
      }

      // TTFS — first audio actually scheduled
      if (!firstSpeechRecordedRef.current && kickoffTimeRef.current !== null) {
        firstSpeechRecordedRef.current = true;
        const ttfs = Date.now() - kickoffTimeRef.current;
        useSessionStore.getState().setTimeToFirstSpeechMs(ttfs);
        useSessionStore.getState().logTiming(`live: TTFS ${ttfs}ms`);
        useSessionStore.getState().setHasSpokenThisSession(true);
      }
      useSessionStore.getState().setIsSpeaking(true);
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        console.error("[live] TTS error:", e);
        useSessionStore.getState().logTiming(`live: TTS error — ${(e as Error).message}`);
      }
    }
  }

  /** Enqueue a TTS request at the end of the sequential chain. */
  function queueSpeak(text: string) {
    const gen = ttsGenerationRef.current;
    ttsChainRef.current = ttsChainRef.current.then(() => speakText(text, gen));
  }

  /** Flush any remaining text in the buffer to TTS (called on turnComplete). */
  function flushTextBuffer() {
    const remaining = textBufferRef.current.trim();
    if (remaining) {
      queueSpeak(remaining);
      textBufferRef.current = "";
    }
  }

  /** Cancel all pending TTS (barge-in or stop). */
  function cancelTts() {
    ttsGenerationRef.current++;
    textBufferRef.current = "";
    ttsChainRef.current = Promise.resolve();
  }

  /** Handle incoming messages from Gemini — uses getState() to avoid stale closures */
  function handleMessage(msg: LiveServerMessage) {
    if (!isRunningRef.current) return;
    const store = useSessionStore.getState();

    // GoAway — session is about to end. Must be checked before serverContent guard.
    if (msg.goAway) {
      store.logTiming(`live: goAway — ${JSON.stringify(msg.goAway.timeLeft ?? "")} left`);
      rotateSession();
      return;
    }

    const sc = msg.serverContent;
    if (!sc) return;

    // Model turn — discard PCM audio (we use outputTranscription → ElevenLabs instead).
    // But if any parts carry text (e.g. model outputs text alongside audio), route those to TTS.
    if (sc.modelTurn?.parts) {
      store.addConversationEvent("ai-speech");
      for (const part of sc.modelTurn.parts) {
        if ((part as { thought?: boolean }).thought) continue; // skip Gemini thinking tokens
        const partText = (part as { text?: string }).text;
        if (partText) {
          // Text part in modelTurn — treat same as outputTranscription
          textBufferRef.current += partText;
          transcriptAccRef.current += partText;
          store.setTranscript(transcriptAccRef.current.slice(-200));
          const [motion, intensity] = inferMotionFromTranscript(partText, store.audioAmplitude);
          store.setActiveMotionState(motion, intensity);
          if (geminiSpeakingSpanRef.current === null) {
            if (geminiWaitingSpanRef.current) {
              store.endSpan(geminiWaitingSpanRef.current);
              geminiWaitingSpanRef.current = null;
            }
            geminiSpeakingSpanRef.current = store.beginSpan("gemini", "speaking");
          }
          if (!firstSpeechRecordedRef.current && kickoffTimeRef.current !== null) {
            firstSpeechRecordedRef.current = true;
            const ttfs = Date.now() - kickoffTimeRef.current;
            store.setTimeToFirstSpeechMs(ttfs);
            store.logTiming(`live: TTFS (modelTurn text) ${ttfs}ms`);
            store.setHasSpokenThisSession(true);
          }
          store.setIsSpeaking(true);
          const [sentences, remainder] = extractSentences(textBufferRef.current);
          textBufferRef.current = remainder;
          for (const sentence of sentences) queueSpeak(sentence);
        }
        // inlineData (audio PCM) is intentionally ignored — ElevenLabs handles playback
      }
    }

    // Model was interrupted by user speech (barge-in) — cancel TTS and flush audio
    if (sc.interrupted) {
      cancelTts();
      playback.flush();
      store.setIsSpeaking(false);
      store.addConversationEvent("interrupted");
      store.setActiveMotionState("listening", 0.5);
      store.logTiming("live: interrupted (barge-in)");
      // Close any open gemini spans
      if (geminiSpeakingSpanRef.current) {
        store.endSpan(geminiSpeakingSpanRef.current);
        geminiSpeakingSpanRef.current = null;
      }
      if (geminiWaitingSpanRef.current) {
        store.endSpan(geminiWaitingSpanRef.current);
        geminiWaitingSpanRef.current = null;
      }
    }

    // Model finished its turn — flush any remaining buffered text
    if (sc.turnComplete) {
      flushTextBuffer();
      store.addConversationEvent("ai-done");
      store.setActiveMotionState("idle", 0.3);
      if (geminiSpeakingSpanRef.current) {
        store.endSpan(geminiSpeakingSpanRef.current);
        geminiSpeakingSpanRef.current = null;
      }
    }

    // Output transcription — this is the text of what Gemini is saying.
    // Route to ElevenLabs for voice synthesis; also drive puppet animation.
    if (sc.outputTranscription?.text) {
      const text = sc.outputTranscription.text;
      textBufferRef.current += text;

      transcriptAccRef.current += text;
      store.setTranscript(transcriptAccRef.current.slice(-200));
      const [motion, intensity] = inferMotionFromTranscript(text, store.audioAmplitude);
      store.setActiveMotionState(motion, intensity);

      // On first token of each AI turn: close the waiting span and open a speaking span
      if (geminiSpeakingSpanRef.current === null) {
        if (geminiWaitingSpanRef.current) {
          store.endSpan(geminiWaitingSpanRef.current);
          geminiWaitingSpanRef.current = null;
        }
        geminiSpeakingSpanRef.current = store.beginSpan("gemini", "speaking");
      }

      // TTFS — first transcription token is a proxy for when the model started speaking
      if (!firstSpeechRecordedRef.current && kickoffTimeRef.current !== null) {
        firstSpeechRecordedRef.current = true;
        const ttfs = Date.now() - kickoffTimeRef.current;
        store.setTimeToFirstSpeechMs(ttfs);
        store.logTiming(`live: TTFS ${ttfs}ms`);
        store.setHasSpokenThisSession(true);
      }
      store.setIsSpeaking(true);

      // Send complete sentences to ElevenLabs immediately, buffer remainder
      const [sentences, remainder] = extractSentences(textBufferRef.current);
      textBufferRef.current = remainder;
      for (const sentence of sentences) queueSpeak(sentence);
    }

    // Input transcription — user is speaking
    if (sc.inputTranscription?.text) {
      store.setIsUserSpeaking(true);
      store.addConversationEvent("user-start", sc.inputTranscription?.text?.slice(0, 40));
      store.setActiveMotionState("listening", 0.5);
      // Start user speaking span (extend if already open)
      if (!userSpeakingSpanRef.current) {
        userSpeakingSpanRef.current = store.beginSpan("user", "speaking");
      }
      if (userSpeakingTimerRef.current) clearTimeout(userSpeakingTimerRef.current);
      userSpeakingTimerRef.current = setTimeout(() => {
        if (isRunningRef.current) {
          useSessionStore.getState().setIsUserSpeaking(false);
          // End user speaking span and start gemini processing span
          if (userSpeakingSpanRef.current) {
            useSessionStore.getState().endSpan(userSpeakingSpanRef.current);
            userSpeakingSpanRef.current = null;
          }
          geminiWaitingSpanRef.current = useSessionStore.getState().beginSpan("gemini", "processing", "#92400e");
        }
      }, 500);
    }

    // Waiting for user input
    if (sc.waitingForInput) {
      store.setActiveMotionState("listening", 0.4);
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

  function runVisionAnalyze() {
    const frame = webcamRef.current?.captureFrame();
    if (!frame) return;
    const { burnIntensity: bi, activePersona: ap } = useSessionStore.getState();
    useSessionStore.getState().setLastVisionCallTs(Date.now());
    const visionSpanId = useSessionStore.getState().beginSpan("vision", "analyze");
    fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64: frame, burnIntensity: bi, mode: "vision", persona: ap }),
      signal: AbortSignal.timeout(10_000),
    })
      .then((r) => r.json())
      .then((d) => {
        useSessionStore.getState().endSpan(visionSpanId);
        if (d.observations?.length) useSessionStore.getState().setObservations(d.observations);
        else console.warn("[vision] no observations in response:", d);
      })
      .catch((e) => {
        useSessionStore.getState().endSpan(visionSpanId);
        console.warn("[vision] analyze fetch failed:", e);
      });
  }

  function startVisionSend() {
    stopVisionSend();
    runVisionAnalyze(); // fire immediately on first frame
    visionIntervalRef.current = setInterval(() => {
      if (!isRunningRef.current) return;
      runVisionAnalyze();
    }, VISION_INTERVAL_MS);
  }

  function stopVisionSend() {
    if (visionIntervalRef.current) {
      clearInterval(visionIntervalRef.current);
      visionIntervalRef.current = null;
    }
  }

  /** Seamless session rotation (audio+video sessions cap at 2 min) */
  async function rotateSession() {
    if (!isRunningRef.current) return;
    useSessionStore.getState().logTiming("live: rotating session");
    useSessionStore.getState().addConversationEvent("rotate");
    const rotateSpanId = useSessionStore.getState().beginSpan("session", "rotate");

    try {
      const oldSession = sessionRef.current;
      const newSession = await openSession();
      sessionRef.current = newSession;
      useSessionStore.getState().endSpan(rotateSpanId);

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
      useSessionStore.getState().logTiming(`live: rotation error — ${(err as Error).message}`);
      useSessionStore.getState().endSpan(rotateSpanId);
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

  /** Scripted mock session — exercises TTS + playback + timeline without calling Gemini */
  async function startMockSession() {
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    isRunningRef.current = true;
    transcriptAccRef.current = "";
    textBufferRef.current = "";
    ttsChainRef.current = Promise.resolve();
    ttsGenerationRef.current = 0;
    userSpeakingSpanRef.current = null;
    geminiWaitingSpanRef.current = null;
    geminiSpeakingSpanRef.current = null;
    useSessionStore.getState().clearConversationEvents();
    useSessionStore.getState().clearTimelineSpans();
    useSessionStore.getState().logTiming("mock: starting");

    // Fake connect delay
    const connectSpanId = useSessionStore.getState().beginSpan("session", "mock-connect");
    await sleep(280);
    if (!isRunningRef.current) return;
    useSessionStore.getState().endSpan(connectSpanId);
    useSessionStore.getState().setIsListening(true);
    useSessionStore.getState().logTiming("mock: ready");

    // Initial kickoff — AI speaks first (like the real session)
    geminiWaitingSpanRef.current = useSessionStore.getState().beginSpan("gemini", "processing", "#92400e");
    await sleep(180 + Math.random() * 120);
    if (!isRunningRef.current) return;

    let lineIdx = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (!isRunningRef.current) break;

      // Transition waiting → speaking for this AI turn
      const store = useSessionStore.getState();
      if (geminiWaitingSpanRef.current) {
        store.endSpan(geminiWaitingSpanRef.current);
        geminiWaitingSpanRef.current = null;
      }
      geminiSpeakingSpanRef.current = store.beginSpan("gemini", "speaking");
      store.setIsSpeaking(true);

      const line = MOCK_LINES[lineIdx % MOCK_LINES.length];
      lineIdx++;
      store.setTranscript(line);
      const [motion, intensity] = inferMotionFromTranscript(line, 0.5);
      store.setActiveMotionState(motion, intensity);

      // Queue each sentence through the real TTS pipeline
      const sentences = line.match(/[^.!?]+[.!?]+\s*/g) ?? [line];
      for (const s of sentences) queueSpeak(s);
      await ttsChainRef.current; // wait for the whole chain to finish
      if (!isRunningRef.current) break;

      // End speaking span
      if (geminiSpeakingSpanRef.current) {
        useSessionStore.getState().endSpan(geminiSpeakingSpanRef.current);
        geminiSpeakingSpanRef.current = null;
      }
      useSessionStore.getState().setIsSpeaking(false);
      useSessionStore.getState().setActiveMotionState("idle", 0.3);

      // Simulate listening pause
      await sleep(600 + Math.random() * 400);
      if (!isRunningRef.current) break;

      // Simulate user speaking
      userSpeakingSpanRef.current = useSessionStore.getState().beginSpan("user", "speaking");
      useSessionStore.getState().setIsUserSpeaking(true);
      await sleep(700 + Math.random() * 600);
      if (!isRunningRef.current) break;

      useSessionStore.getState().endSpan(userSpeakingSpanRef.current!);
      userSpeakingSpanRef.current = null;
      useSessionStore.getState().setIsUserSpeaking(false);

      // Simulate Gemini processing
      geminiWaitingSpanRef.current = useSessionStore.getState().beginSpan("gemini", "processing", "#92400e");
      await sleep(300 + Math.random() * 400);
    }
  }

  /** Start the full live session pipeline */
  async function startLiveSession() {
    isRunningRef.current = true;
    transcriptAccRef.current = "";
    textBufferRef.current = "";
    ttsChainRef.current = Promise.resolve();
    ttsGenerationRef.current = 0;
    userSpeakingSpanRef.current = null;
    geminiWaitingSpanRef.current = null;
    geminiSpeakingSpanRef.current = null;
    useSessionStore.getState().clearConversationEvents();
    useSessionStore.getState().clearTimelineSpans();
    useSessionStore.getState().logTiming("live: starting session");

    const connectSpanId = useSessionStore.getState().beginSpan("session", "connect");
    try {
      // Open session and start mic in parallel — mic doesn't need the session to initialize.
      // Pass the pre-fetched token so we skip the extra server round-trip on initial connect.
      const sessionPromise = openSession(prefetchedTokenPromise);
      const micPromise = mic.start().catch((e) => console.warn("[live] mic start failed:", e));
      const session = await sessionPromise;
      await micPromise;
      sessionRef.current = session;
      useSessionStore.getState().endSpan(connectSpanId);
      useSessionStore.getState().logTiming("live: session + mic ready");

      // Kick off immediately — pure text first so the model starts generating before frame analysis.
      // Sending video BEFORE kickoff forces multi-modal processing and delays first audio.
      kickoffTimeRef.current = Date.now();
      firstSpeechRecordedRef.current = false;
      useSessionStore.getState().setTimeToFirstSpeechMs(null);
      useSessionStore.getState().setHasSpokenThisSession(false);
      geminiWaitingSpanRef.current = useSessionStore.getState().beginSpan("gemini", "processing", "#92400e");
      session.sendClientContent({
        turns: [{ role: "user", parts: [{ text: "Go!" }] }],
        turnComplete: true,
      });
      useSessionStore.getState().logTiming("live: kickoff sent");

      // Send first webcam frame AFTER kickoff — model incorporates it as it streams audio
      const frame = webcamRef.current?.captureFrame();
      if (frame) {
        session.sendRealtimeInput({
          video: { data: frame, mimeType: "image/jpeg" },
        });
        useSessionStore.getState().logTiming("live: initial frame sent");
      }

      // Start webcam frame sending (1fps interval)
      startWebcamSend();
      useSessionStore.getState().logTiming("live: webcam sender started");

      // Schedule session rotation
      scheduleRotation();

      // Start recurring vision analyze (fires immediately, then every 3s)
      startVisionSend();
    } catch (err) {
      console.error("[live] Failed to start:", err);
      useSessionStore.getState().logTiming(`live: start error — ${(err as Error).message}`);
      useSessionStore.getState().endSpan(connectSpanId);
      useSessionStore.getState().setError(
        `Live session failed: ${(err as Error).message}. Try monologue mode.`,
      );
      useSessionStore.getState().setPhase("idle");
    }
  }

  /** Stop everything cleanly */
  async function stopLiveSession() {
    isRunningRef.current = false;

    // Close any open timeline spans
    const store = useSessionStore.getState();
    if (userSpeakingSpanRef.current) { store.endSpan(userSpeakingSpanRef.current); userSpeakingSpanRef.current = null; }
    if (geminiWaitingSpanRef.current) { store.endSpan(geminiWaitingSpanRef.current); geminiWaitingSpanRef.current = null; }
    if (geminiSpeakingSpanRef.current) { store.endSpan(geminiSpeakingSpanRef.current); geminiSpeakingSpanRef.current = null; }

    // Reset puppet sleep state so lights/pose go dormant immediately
    store.setHasSpokenThisSession(false);

    // Stop timers
    stopWebcamSend();
    stopVisionSend();
    if (rotateTimerRef.current) clearTimeout(rotateTimerRef.current);

    // Cancel pending TTS
    cancelTts();

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

    useSessionStore.getState().setIsSpeaking(false);
    useSessionStore.getState().setIsListening(false);
    useSessionStore.getState().setIsUserSpeaking(false);
    useSessionStore.getState().setActiveMotionState("idle", 0.3);

    // Stop recording
    if (videoRecorderRef.current) {
      try {
        const blob = await videoRecorderRef.current.stop();
        useSessionStore.getState().setRecordedBlob(blob);
      } catch (err) {
        console.error("[live] Recording stop error:", err);
      }
    }
  }

  // Lifecycle: start/stop based on phase
  useEffect(() => {
    if (phase === "roasting") {
      const sessionStart = mockMode ? startMockSession() : startLiveSession();
      // Wire recording after session is up (mock mode skips mic so no merged stream needed)
      sessionStart.then(() => {
        if (!mockMode && videoRecorderRef.current && compositorStream && isRunningRef.current) {
          const audioStream = createMergedAudioStream() ?? playback.getDestinationStream();
          videoRecorderRef.current.start(compositorStream, audioStream);
        }
      });
    } else if (phase === "stopped") {
      stopLiveSession(); // stays at "stopped" — user can restart or share from HUD
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isRunningRef.current = false;
      stopWebcamSend();
      stopVisionSend();
      if (rotateTimerRef.current) clearTimeout(rotateTimerRef.current);
      if (userSpeakingTimerRef.current) clearTimeout(userSpeakingTimerRef.current);
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
