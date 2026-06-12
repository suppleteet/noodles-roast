"use client";
import { useEffect, useRef, useCallback } from "react";
import { GoogleGenAI, Modality } from "@google/genai";
import type { Session, LiveServerMessage } from "@google/genai";
import { useSessionStore, pickDifferentModel, type RoastModelId } from "@/store/useSessionStore";
import type { WebcamCaptureHandle } from "./WebcamCapture";
import type { VideoRecorderHandle } from "@/components/recording/VideoRecorder";
import { useMicCapture } from "@/components/audio/useMicCapture";
import { useVad } from "@/components/audio/useVad";
import { usePcmPlayback } from "@/components/audio/usePcmPlayback";
import { float32ToBase64Pcm16 } from "@/lib/audioUtils";
import { inferMotionFromTranscript } from "@/lib/motionInference";
import {
  LIVE_MODEL,
  LIVE_VOICE_NAME,
  WEBCAM_SEND_INTERVAL_MS,
  SESSION_ROTATE_MS,
  MIC_MIME_TYPE,
  MOCK_LINES,
} from "@/lib/liveConstants";
import { getLiveTranscriptionPrompt } from "@/lib/livePrompts";
import { ComedianBrain } from "@/lib/comedianBrain";
import type { MotionState } from "@/lib/motionStates";
import { COMEDIAN_CONFIG } from "@/lib/comedianConfig";
import { kickTownFlavorFetch } from "@/lib/kickTownFlavorFetch";
import type { JokeResponse } from "@/app/api/generate-joke/route";
import {
  prefetchParallelVisionAndGreeting,
  prefetchCannedOpener,
  type CannedOpenerPrefetch,
} from "@/lib/greetingPrefetch";
import { voiceSettingsForMotion, gainForMotion } from "@/lib/voiceMotionPresets";
import { TtsChunkBuffer } from "@/lib/ttsChunkBuffer";

/**
 * Remove asterisk-wrapped stage directions (e.g. "*sip*", "*clink*", "*gestures*")
 * before any text reaches TTS or the transcript. No persona should ever SPEAK
 * these — ElevenLabs would pronounce the word literally ("sip"). Toast's bank
 * questions embed them for on-page rhythm and now play verbatim (rephrase is
 * skipped for Toast), so this is the single guaranteed place to drop them.
 * Surrounding em-dash pauses are preserved so the drunk cadence survives.
 */
function stripStageDirections(text: string): string {
  return text
    .replace(/\*[^*\n]*\*/g, "")        // drop *sip* / *clink* / *gestures* tokens
    .replace(/\s*—\s*—\s*/g, " — ")     // collapse a "— —" left by a removed mid-clause token
    .replace(/[ \t]{2,}/g, " ")          // collapse runs of spaces the removal left behind
    .replace(/[ \t]+([.,!?;:])/g, "$1")  // tidy any space stranded before punctuation
    .trim();
}

interface Props {
  webcamRef: React.RefObject<WebcamCaptureHandle | null>;
  videoRecorderRef: React.RefObject<VideoRecorderHandle | null>;
  compositorStream: MediaStream | null;
  mediaStream?: MediaStream | null;
  prefetchedTokenPromise?: Promise<string> | null;
  /** Comedian chat session pre-created at button press (page.tsx) so its cold
   *  latency overlaps the permission grant. Resolves to the sessionId, or null
   *  on failure — in which case the connect effect creates one itself. */
  prefetchedComedianSessionPromise?: Promise<string | null> | null;
  /** Parallel vision + greeting jokes started in page.tsx as soon as the camera stream exists (before roasting). */
  warmupGreetingPrefetch?: Promise<JokeResponse | null> | null;
  /** Audio chunks already streaming in for the greeting joke — saves the
   *  EL handshake/synth round-trip when the brain reaches enterGreeting. */
  warmupGreetingAudio?: Promise<TtsChunkBuffer | null> | null;
  /** Canned-intro opener picked + TTS-prefetched in page.tsx during the
   *  permission window. Null/absent when the canned intro doesn't apply. */
  warmupCannedOpener?: Promise<CannedOpenerPrefetch | null> | null;
  mockMode?: boolean;
}

export default function LiveSessionController({
  webcamRef,
  videoRecorderRef,
  compositorStream,
  mediaStream,
  prefetchedTokenPromise,
  prefetchedComedianSessionPromise,
  warmupGreetingPrefetch,
  warmupGreetingAudio,
  warmupCannedOpener,
  mockMode = false,
}: Props) {
  // Only subscribe to phase + pendingDebugTranscription for lifecycle/debug.
  // All other store access uses getState() to avoid stale closures.
  const phase = useSessionStore((s) => s.phase);
  const pendingDebugTranscription = useSessionStore((s) => s.pendingDebugTranscription);
  const pendingDevNoteResume = useSessionStore((s) => s.pendingDevNoteResume);

  const sessionRef = useRef<Session | null>(null);
  const isRunningRef = useRef(false);
  const webcamIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const visionIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rotateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userSpeakingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const laughDecayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const smileDecayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const micChunkLoggedRef = useRef(false);
  const micSentLoggedRef = useRef(false);
  const micBlockedLoggedRef = useRef(false);

  const kickoffTimeRef = useRef<number | null>(null);
  const firstSpeechRecordedRef = useRef(false);

  // Gemini multi-turn chat session ID (comedian persona loaded once)
  const comedianSessionIdRef = useRef<string | null>(null);

  // TTS pipeline — brain-driven, sequential ElevenLabs requests
  const ttsChainRef = useRef<Promise<void>>(Promise.resolve());
  const ttsGenerationRef = useRef(0);

  // rAF for TTS drain detection
  const drainRafRef = useRef<number>(0);
  const wasDrainedRef = useRef(true); // track edge: false → true
  const earlyListenFiredRef = useRef(false); // true once early-listen has fired for current question

  // Mic → recording mix (disconnect function returned by addInputToRecording)
  const micRecordingDisconnectRef = useRef<(() => void) | null>(null);
  const pendingVadStreamRef = useRef<MediaStream | null>(null);
  const vadStartRequestedRef = useRef(false);

  // Timeline span IDs
  const userSpeakingSpanRef = useRef<string | null>(null);
  const geminiWaitingSpanRef = useRef<string | null>(null);

  // Vocal continuity: last text spoken by puppet — passed as previous_text to ElevenLabs so
  // each TTS request inherits the intonation/prosody of what came before.
  const lastSpokenTextRef = useRef<string>("");

  // Audio pipeline hooks
  const playback = usePcmPlayback();
  const mic = useMicCapture(
    useCallback((pcm: Float32Array) => {
      const session = sessionRef.current;
      if (!session || !isRunningRef.current) return;
      if (!micChunkLoggedRef.current) {
        micChunkLoggedRef.current = true;
        useSessionStore.getState().logTiming(`mic: first PCM chunk (${pcm.length} samples)`);
      }
      // Gate mic: send audio when brain is listening OR in passive warm-up (keeps Gemini VAD hot)
      const brain = brainRef.current;
      if (brain && !brain.isAudioActive()) {
        if (!micBlockedLoggedRef.current) {
          micBlockedLoggedRef.current = true;
          useSessionStore.getState().logTiming("mic: chunk blocked while brain audio inactive");
        }
        return;
      }
      const base64 = float32ToBase64Pcm16(pcm);
      try {
        session.sendRealtimeInput({
          audio: { data: base64, mimeType: MIC_MIME_TYPE },
        });
        if (!micSentLoggedRef.current) {
          micSentLoggedRef.current = true;
          useSessionStore.getState().logTiming("mic: first chunk sent to Gemini");
        }
      } catch {
        // Session WebSocket may be in CLOSING state during rotation — safe to discard chunk
      }
    }, []),
  );

  // Silero VAD — fast end-of-speech detection (~200ms vs 300ms silence timer fallback)
  const vad = useVad({
    onSpeechEnd: () => {
      if (isRunningRef.current) {
        useSessionStore.getState().setIsUserSpeaking(false);
      }
      brainRef.current?.onVadSpeechEnd();
    },
    onSpeechStart: () => {
      if (isRunningRef.current) {
        useSessionStore.getState().setIsUserSpeaking(true);
      }
    },
  });

  // ComedianBrain — instantiated when session starts
  const brainRef = useRef<ComedianBrain | null>(null);

  // Debug: consume typed transcription and forward to brain (same as mic input)
  useEffect(() => {
    if (!pendingDebugTranscription || !brainRef.current) return;
    const text = pendingDebugTranscription;
    useSessionStore.getState().clearPendingDebugTranscription();
    useSessionStore.getState().pushTranscriptEntry("user", text);
    useSessionStore.getState().logTiming(`debug-input: "${text}"`);
    brainRef.current.onInputTranscription(text, true);
  }, [pendingDebugTranscription]);

  // Dev voice notes: consume resume signal and forward to brain
  useEffect(() => {
    if (!pendingDevNoteResume || !brainRef.current) return;
    useSessionStore.getState().clearPendingDevNoteResume();
    brainRef.current.resumeFromDevNote();
  }, [pendingDevNoteResume]);

  // ─── Brain helpers ────────────────────────────────────────────────────────────

  function queueSpeak(
    text: string,
    motion?: MotionState,
    intensity?: number,
    appendToPrev?: boolean,
    voiceOverride?: Partial<import("@/store/useSessionStore").VoiceSettings>,
  ): void {
    text = stripStageDirections(text);
    if (!text.trim() || !isRunningRef.current) return;
    useSessionStore.getState().pushTranscriptEntry("puppet", text.trim(), { append: appendToPrev });
    wasDrainedRef.current = false; // reset edge so drain detection fires when this plays through
    const gen = ttsGenerationRef.current;

    // Snapshot previousText NOW (at queue time) for vocal continuity,
    // then update lastSpokenTextRef immediately so the NEXT queueSpeak gets the right context.
    const previousText = lastSpokenTextRef.current;
    lastSpokenTextRef.current = text.trim();

    // Fire TTS fetch NOW; starts generating audio while previous joke is still playing.
    // Playback streams chunks as soon as this line reaches the front of the chain.
    const audioBuffer = prefetchTts(text.trim(), gen, previousText, motion, intensity, voiceOverride);

    ttsChainRef.current = ttsChainRef.current.then(async () => {
      if (ttsGenerationRef.current !== gen || !isRunningRef.current) return;
      if (motion) useSessionStore.getState().setActiveMotionState(motion, intensity ?? 0.7);
      const prevTail = previousText.length > 60 ? `…${previousText.slice(-60)}` : previousText;
      useSessionStore.getState().logTiming(
        `tts: "${text.trim().slice(0, 60)}" prev="${prevTail}"`,
      );
      await scheduleFromPrefetch(audioBuffer, gen, gainForMotion(motion, intensity));
    });
  }

  /**
   * Streaming-TTS variant: open an audio sink for a joke that's being
   * generated AND TTS-streamed server-side. Audio bytes arrive via SSE
   * `audio` events and get pushed into the returned sink. The sink slots
   * into the same ttsChainRef so playback stays in order vs other jokes
   * and non-streaming speech (fillers, questions, prods).
   */
  function openJokeStream(
    motion: MotionState,
    intensity: number,
    options?: { appendToPrev?: boolean },
  ): {
    pushAudio: (b64: string) => void;
    finalize: (text: string) => void;
    endAudio: () => void;
    cancel: () => void;
  } {
    const noop = {
      pushAudio: () => {},
      finalize: () => {},
      endAudio: () => {},
      cancel: () => {},
    };
    if (!isRunningRef.current) return noop;
    const gen = ttsGenerationRef.current;
    wasDrainedRef.current = false;
    const audio = new TtsChunkBuffer();
    const sinkOpenedAt = Date.now();
    let firstAudioLogged = false;
    const ttsSpanId = useSessionStore.getState().beginSpan("tts", `stream:${motion}`);
    let spanEnded = false;
    const endSpan = () => {
      if (spanEnded) return;
      spanEnded = true;
      useSessionStore.getState().endSpan(ttsSpanId);
    };

    ttsChainRef.current = ttsChainRef.current.then(async () => {
      if (ttsGenerationRef.current !== gen || !isRunningRef.current) {
        audio.finish(true);
        endSpan();
        return;
      }
      useSessionStore.getState().setActiveMotionState(motion, intensity);
      useSessionStore.getState().logTiming(
        `tts-stream: motion=${motion} intensity=${intensity.toFixed(2)}`,
      );
      try {
        await scheduleFromPrefetch(audio, gen, gainForMotion(motion, intensity));
      } finally {
        endSpan();
      }
    });

    return {
      pushAudio(b64: string) {
        if (ttsGenerationRef.current !== gen || !isRunningRef.current) return;
        if (!firstAudioLogged) {
          // The streamed-joke path had no audio-arrival telemetry — EL synthesis
          // lag here is invisible in the log yet is the main mid-set pause source.
          firstAudioLogged = true;
          useSessionStore
            .getState()
            .logTiming(`tts-stream: first audio ${Date.now() - sinkOpenedAt}ms (${motion})`);
        }
        audio.push(b64);
      },
      finalize(text: string) {
        // Record transcript only — EL is still synthesizing the tail of audio.
        // Do NOT mark `audio.done` here, or scheduleFromPrefetch will exit
        // before the remaining chunks arrive and the joke gets cut off.
        if (text.trim()) {
          useSessionStore
            .getState()
            .pushTranscriptEntry("puppet", text.trim(), { append: options?.appendToPrev });
          lastSpokenTextRef.current = text.trim();
        }
      },
      endAudio() {
        audio.finish(false);
      },
      cancel() {
        audio.finish(true);
        endSpan();
      },
    };
  }

  function cancelSpeech(): void {
    ttsGenerationRef.current++;
    ttsChainRef.current = Promise.resolve();
    playback.flush();
    useSessionStore.getState().setIsSpeaking(false);
  }

  /**
   * Play an audio buffer that has already started filling from a prefetch
   * (greeting audio prefetched in page.tsx while permissions were being
   * granted). Saves the EL handshake + synth round-trip on greeting.
   * Falls back to legacy queueSpeak if the prefetch failed or no buffer.
   */
  function playPrefetchedAudio(
    text: string,
    buffer: TtsChunkBuffer,
    motion?: MotionState,
    intensity?: number,
    appendToPrev?: boolean,
    // Merged over resolved settings when the line is RE-synthesized (failed or
    // stalled buffer). The opener passes its style cap here — a real session
    // lost it on the watchdog path and the re-synthesized opener screeched.
    voiceOverride?: Partial<import("@/store/useSessionStore").VoiceSettings>,
  ): void {
    // NOTE: `buffer` was synthesized upstream (greeting prefetch in page.tsx) from
    // the original text, so stripping here only sanitizes the TRANSCRIPT, not the
    // audio. That's fine: the only prefetched path is the LLM-generated greeting,
    // whose prompt forbids stage directions — so there's nothing to mismatch. The
    // failed-buffer fallback below re-routes through queueSpeak, which synthesizes
    // from this stripped text directly.
    text = stripStageDirections(text);
    if (!text.trim() || !isRunningRef.current) return;
    if (buffer.failed) {
      // TTS prefetch errored — fall back to legacy queueSpeak.
      queueSpeak(text, motion, intensity, appendToPrev, voiceOverride);
      return;
    }
    useSessionStore.getState().pushTranscriptEntry("puppet", text.trim(), { append: appendToPrev });
    wasDrainedRef.current = false;
    const gen = ttsGenerationRef.current;
    const previousText = lastSpokenTextRef.current;
    lastSpokenTextRef.current = text.trim();

    // Watchdog: a prefetched buffer that never receives audio (hung /api/tts-ws,
    // EL WS that silently dies before the first chunk) leaves scheduleFromPrefetch
    // parked on waitForUpdate forever — the show opens on dead silence with no
    // drain edge to advance it (a real local session sat mute for 10s until the
    // user gave up). If nothing has arrived in time, kill the buffer (unblocks
    // the chain) and re-synthesize the same text through legacy queueSpeak.
    const PREFETCH_AUDIO_WATCHDOG_MS = 2_500;
    setTimeout(() => {
      if (!isRunningRef.current || ttsGenerationRef.current !== gen) return;
      if (buffer.chunks.length > 0) return; // audio arrived (or is playing) — healthy
      useSessionStore.getState().logTiming(
        `tts-prefetched: no audio after ${PREFETCH_AUDIO_WATCHDOG_MS}ms (done=${buffer.done} failed=${buffer.failed}) — re-synthesizing via queueSpeak`,
      );
      if (!buffer.done) buffer.finish(true); // release scheduleFromPrefetch
      queueSpeak(text, motion, intensity, appendToPrev, voiceOverride);
    }, PREFETCH_AUDIO_WATCHDOG_MS);

    ttsChainRef.current = ttsChainRef.current.then(async () => {
      if (ttsGenerationRef.current !== gen || !isRunningRef.current) return;
      if (motion) useSessionStore.getState().setActiveMotionState(motion, intensity ?? 0.7);
      const prevTail = previousText.length > 60 ? `…${previousText.slice(-60)}` : previousText;
      useSessionStore.getState().logTiming(
        `tts-prefetched: "${text.trim().slice(0, 60)}" chunks=${buffer.chunks.length} done=${buffer.done} prev="${prevTail}"`,
      );
      await scheduleFromPrefetch(buffer, gen, gainForMotion(motion, intensity));
    });
  }

  /**
   * Model trouble (Tyler: "say his brain is busted and ask if they want to start
   * over with a different model" — no silent swap). The brain has already spoken
   * the in-character busted line and is ending the session; here we just surface
   * the restart prompt by stashing a different suggested model in the store. The
   * page-level modal owns Yes (restart with that model) / Cancel (back to landing).
   */
  function promptModelRestart(failedModel: string): void {
    const store = useSessionStore.getState();
    if (store.modelUnavailable) return; // already prompting
    const different = pickDifferentModel(store.roastModel as RoastModelId);
    store.setModelUnavailable({ failedModel, suggestedFallback: different });
    store.logTiming(`live: model trouble (${failedModel}) — prompting restart with ${different}`);
  }

  // ─── TTS pipeline ─────────────────────────────────────────────────────────────

  /**
   * Start TTS stream immediately — buffer audio chunks.
   * Fires outside the chain so multiple prefetches overlap (no dead air between jokes).
   */
  function prefetchTts(
    text: string,
    gen: number,
    previousText?: string,
    motion?: MotionState,
    intensity?: number,
    voiceOverride?: Partial<import("@/store/useSessionStore").VoiceSettings>,
  ): TtsChunkBuffer {
    const audio = new TtsChunkBuffer();
    if (!isRunningRef.current) {
      audio.finish(true);
      return audio;
    }
    const ttsSpanId = useSessionStore.getState().beginSpan("tts", text.slice(0, 22));
    let spanEnded = false;
    const endSpan = () => {
      if (spanEnded) return;
      spanEnded = true;
      useSessionStore.getState().endSpan(ttsSpanId);
    };

    void (async () => {
      const startedAt = Date.now();
      let firstAudioLogged = false;
      try {
        // Base voice comes from the store for BOTH experiences so the debug
        // VoiceSliders drive playback live. Toast's drunk defaults are seeded
        // into the store by setExperienceType when she's picked.
        const baseVoice = useSessionStore.getState().voiceSettings;
        const motionMerged = voiceSettingsForMotion(baseVoice, motion, intensity);
        // voiceOverride wins last — used to slow fillers below the base speed.
        const mergedVoice = voiceOverride ? { ...motionMerged, ...voiceOverride } : motionMerged;
        const resp = await fetch("/api/tts-ws", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            ...(previousText ? { previousText } : {}),
            voiceSettings: mergedVoice,
            experienceType: useSessionStore.getState().experienceType,
          }),
        });

        if (!resp.ok || !resp.body || ttsGenerationRef.current !== gen) {
          endSpan();
          audio.finish(true);
          return;
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (ttsGenerationRef.current !== gen || !isRunningRef.current) {
            reader.cancel();
            endSpan();
            audio.finish(true);
            return;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const event = JSON.parse(line.slice(6)) as { type: string; chunk?: string };
              if (event.type === "audio" && event.chunk) {
                if (!firstAudioLogged) {
                  firstAudioLogged = true;
                  useSessionStore.getState().logTiming(
                    `tts: first audio ${Date.now() - startedAt}ms "${text.slice(0, 32)}"`,
                  );
                }
                audio.push(event.chunk);
              }
            } catch { /* malformed SSE line */ }
          }
        }

        endSpan();
        audio.finish();
      } catch (e) {
        endSpan();
        audio.finish(true);
        if ((e as Error).name !== "AbortError") {
          console.error("[live] TTS prefetch error:", e);
        }
      }
    })();

    return audio;
  }

  /**
   * Enqueue chunks as soon as they are available for this line's turn.
   * Runs inside the ttsChain so playback order is preserved.
   */
  async function scheduleFromPrefetch(
    audio: TtsChunkBuffer,
    gen: number,
    gain = 1,
  ): Promise<void> {
    let cursor = 0;
    let queuedAny = false;

    while (isRunningRef.current && ttsGenerationRef.current === gen) {
      while (cursor < audio.chunks.length) {
        // Before queueing the very first chunk of the session: reveal the
        // puppet, then hold for a beat. The page-level black overlay fades
        // out over ~500ms; without the wait, the user heard the puppet
        // talking while still mid-fade — jarring. Holding here lets the
        // fade complete and gives him a moment of "sitting there looking
        // at you" before he opens his mouth.
        if (!queuedAny && !firstSpeechRecordedRef.current) {
          useSessionStore.getState().setPuppetRevealed(true);
          startVideoRecordingIfNeeded();
          await new Promise<void>((resolve) =>
            setTimeout(resolve, COMEDIAN_CONFIG.firstSpeechBeatMs),
          );
          if (ttsGenerationRef.current !== gen || !isRunningRef.current) return;
        }
        playback.enqueueChunk(audio.chunks[cursor], gain);
        cursor++;
        if (!queuedAny) {
          queuedAny = true;
          useSessionStore.getState().setPuppetRevealed(true);
          recordTtfs();
          useSessionStore.getState().setIsSpeaking(true);
        }
      }

      if (audio.done) break;
      await audio.waitForUpdate();
    }

    if (ttsGenerationRef.current !== gen) playback.flush();
  }

  /**
   * Start the MP4 recorder lazily — at the moment the puppet is revealed (when
   * the black overlay starts fading). Recording at session kickoff added
   * several seconds of dead time (greeting LLM + TTS prefetch) to the front of
   * every clip. Called from scheduleFromPrefetch's first-chunk branch.
   */
  function startVideoRecordingIfNeeded(): void {
    if (mockMode) return;
    if (!videoRecorderRef.current || !compositorStream || !isRunningRef.current) return;
    if (videoRecorderRef.current.isRecording()) return;
    videoRecorderRef.current.start(compositorStream, playback.getDestinationStream());
    useSessionStore.getState().logTiming(
      `live: recording start requested (${compositorStream.getVideoTracks().length}v/${playback.getDestinationStream()?.getAudioTracks().length ?? 0}a)`,
    );
  }

  /** Record time-to-first-speech metric. */
  function recordTtfs(): void {
    if (!firstSpeechRecordedRef.current && kickoffTimeRef.current !== null) {
      firstSpeechRecordedRef.current = true;
      const ttfs = Date.now() - kickoffTimeRef.current;
      useSessionStore.getState().setTimeToFirstSpeechMs(ttfs);
      useSessionStore.getState().logTiming(`brain: TTFS ${ttfs}ms`);
      useSessionStore.getState().setHasSpokenThisSession(true);
      startVadWhenSafe();
    }
  }

  function startVadWhenSafe(): void {
    const micStream = pendingVadStreamRef.current;
    if (!micStream || vadStartRequestedRef.current || !isRunningRef.current) return;
    if (!firstSpeechRecordedRef.current) return;

    vadStartRequestedRef.current = true;
    window.setTimeout(() => {
      const stream = pendingVadStreamRef.current;
      if (!stream || !isRunningRef.current || !brainRef.current) return;
      vad.start(stream)
        .then(() => {
          useSessionStore.getState().logTiming("vad: ready");
          brainRef.current?.setVadAvailable(true);
        })
        .catch((e) => {
          brainRef.current?.setVadAvailable(false);
          console.warn("[live] VAD start failed (falling back to silence timer):", e);
        });
    }, 500);
  }

  // ─── TTS drain detection via rAF ─────────────────────────────────────────────

  function startDrainPolling(): void {
    stopDrainPolling();
    // Initialize "drained" so the first poll doesn't fire onTtsQueueDrained
    // before any audio has been queued. The first real drain edge fires after
    // queueSpeak resets this to false and audio actually plays through.
    wasDrainedRef.current = true;
    earlyListenFiredRef.current = false;

    function poll() {
      if (!isRunningRef.current) return;

      // Wait for ttsChain to settle before checking audio queue
      ttsChainRef.current.then(() => {
        if (!isRunningRef.current) return;
        const isEmpty = playback.isQueueEmpty();
        const store = useSessionStore.getState();

        if (isEmpty && !wasDrainedRef.current) {
          // Transition: playing → drained
          wasDrainedRef.current = true;
          earlyListenFiredRef.current = false;
          store.setIsSpeaking(false);
          store.setActiveMotionState("idle", 0.3);
          brainRef.current?.onTtsQueueDrained();
        } else if (!isEmpty) {
          wasDrainedRef.current = false;

          // Activate mic early when question is nearly done
          if (
            !earlyListenFiredRef.current &&
            store.brainState === "ask_question" &&
            playback.getPlaybackRemainingMs() <= COMEDIAN_CONFIG.earlyListenMs
          ) {
            earlyListenFiredRef.current = true;
            brainRef.current?.activateEarlyListen();
            store.setIsListening(true);
          }
        }

        drainRafRef.current = requestAnimationFrame(poll);
      });
    }

    drainRafRef.current = requestAnimationFrame(poll);
  }

  function stopDrainPolling(): void {
    if (drainRafRef.current) {
      cancelAnimationFrame(drainRafRef.current);
      drainRafRef.current = 0;
    }
  }

  // ─── Token + Session ──────────────────────────────────────────────────────────

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

  async function openSession(tokenPromise?: Promise<string> | null): Promise<Session> {
    const connectWithToken = async (token: string): Promise<Session> => {
      const ai = new GoogleGenAI({
        apiKey: token,
        httpOptions: { apiVersion: "v1alpha" },
      });

      // Mutable handler boxes: we need the session reference inside onclose to
      // tell expected closes (rotation/stop) from unexpected ones, but the
      // session doesn't exist until ai.live.connect resolves. Set after.
      const onCloseRef: { run: () => void } = { run: () => {} };

      const session = await ai.live.connect({
        model: LIVE_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: LIVE_VOICE_NAME } },
          },
          systemInstruction: getLiveTranscriptionPrompt(),
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
          onclose: () => onCloseRef.run(),
        },
      });

      onCloseRef.run = () => {
        useSessionStore.getState().logTiming("live: session closed");
        useSessionStore.getState().setIsListening(false);
        // If the still-active session is THIS one, the close was unexpected
        // (server-initiated drop). Rotation swaps sessionRef BEFORE closing the
        // old session, so legitimate rotation/stop closes won't match here.
        if (sessionRef.current === session) {
          reconnectAfterUnexpectedClose();
        }
      };

      return session;
    };

    const token = tokenPromise ? await tokenPromise.catch(() => fetchToken()) : await fetchToken();
    try {
      return await connectWithToken(token);
    } catch (e) {
      if (!tokenPromise) throw e;
      useSessionStore.getState().logTiming("live: prefetched token rejected — retrying fresh");
      return connectWithToken(await fetchToken());
    }
  }

  // ─── Message handler ──────────────────────────────────────────────────────────

  function handleMessage(msg: LiveServerMessage) {
    if (!isRunningRef.current) return;
    const store = useSessionStore.getState();

    // GoAway — session is about to end
    if (msg.goAway) {
      store.logTiming(`live: goAway — ${JSON.stringify(msg.goAway.timeLeft ?? "")} left`);
      rotateSession();
      return;
    }

    const sc = msg.serverContent;
    if (!sc) return;

    // Gemini audio output — discard PCM, log transcription only
    if (sc.modelTurn?.parts) {
      for (const part of sc.modelTurn.parts) {
        if ((part as { thought?: boolean }).thought) continue;
        const partText = (part as { text?: string }).text;
        if (partText) {
          // Log only — ComedianBrain controls all speech
          store.logTiming(`live: gemini-text (discarded) — ${partText.slice(0, 40)}`);
        }
      }
    }

    // Output transcription (what Gemini is saying) — discarded in brain mode
    if (sc.outputTranscription?.text) {
      store.logTiming(`live: gemini-output (discarded) — ${sc.outputTranscription.text.slice(0, 40)}`);
    }

    // Interrupted — user barged in
    if (sc.interrupted) {
      store.setIsSpeaking(false);
      store.addConversationEvent("interrupted");
      store.logTiming("live: interrupted (barge-in)");
      brainRef.current?.onInterrupted();
    }

    // Turn complete — Gemini finished its (discarded) turn
    if (sc.turnComplete) {
      store.addConversationEvent("ai-done");
    }

    // Input transcription — user is speaking
    if (sc.inputTranscription?.text) {
      const text = sc.inputTranscription.text;
      store.setIsUserSpeaking(true);
      store.addConversationEvent("user-start", text.slice(0, 40));
      store.setTranscript(text.slice(-200));
      store.pushTranscriptEntry("user", text);

      // Infer puppet listening animation
      const [motion, intensity] = inferMotionFromTranscript(text, store.audioAmplitude);
      store.setActiveMotionState(motion, intensity);

      // Route to brain (pass finished flag so brain can use authoritative final text)
      brainRef.current?.onInputTranscription(text, sc.inputTranscription.finished ?? false);

      // Start user speaking span
      if (!userSpeakingSpanRef.current) {
        userSpeakingSpanRef.current = store.beginSpan("user", "speaking");
      }
      if (userSpeakingTimerRef.current) clearTimeout(userSpeakingTimerRef.current);
      userSpeakingTimerRef.current = setTimeout(() => {
        if (isRunningRef.current) {
          useSessionStore.getState().setIsUserSpeaking(false);
          if (userSpeakingSpanRef.current) {
            useSessionStore.getState().endSpan(userSpeakingSpanRef.current);
            userSpeakingSpanRef.current = null;
          }
          geminiWaitingSpanRef.current = useSessionStore.getState().beginSpan("gemini", "processing", "#92400e");
        }
      }, 500);
    }

    if (sc.waitingForInput) {
      store.setActiveMotionState("listening", 0.4);
    }
  }

  // ─── Laugh + smile detection (vision-based) ────────────────────────────────────

  const LAUGH_KEYWORDS = [
    "laugh", "cracking up", "giggl", "chuckl", "hysterical",
    "grin", "smirk", "smiling broadly", "broad smile", "big smile", "amused",
  ];
  const SMILE_KEYWORDS = ["smile", "smiling", "grinning", "beaming", "happy", "amused", "cheerful"];
  const LAUGH_DECAY_MS = 4000;
  const SMILE_DECAY_MS = 4000;

  function detectExpression(observations: string[]) {
    const store = useSessionStore.getState();
    const lowerObs = observations.map((o) => o.toLowerCase());

    // Laugh detection
    const isLaughing = lowerObs.some((obs) =>
      LAUGH_KEYWORDS.some((kw) => obs.includes(kw)),
    );

    if (isLaughing) {
      if (!store.isUserLaughing) {
        store.incrementLaughCount();
      }
      store.setIsUserLaughing(true);
      store.addConversationEvent("user-laugh");
      if (laughDecayTimerRef.current) clearTimeout(laughDecayTimerRef.current);
      laughDecayTimerRef.current = setTimeout(clearLaughter, LAUGH_DECAY_MS);
    }

    // Smile detection
    const isSmiling = lowerObs.some((obs) =>
      SMILE_KEYWORDS.some((kw) => obs.includes(kw)),
    );

    if (isSmiling) {
      store.setIsUserSmiling(true);
      if (smileDecayTimerRef.current) clearTimeout(smileDecayTimerRef.current);
      smileDecayTimerRef.current = setTimeout(clearSmile, SMILE_DECAY_MS);
    }

    // Record this vision frame for smile percentage
    store.recordVisionFrame(isSmiling || isLaughing);
  }

  function clearLaughter() {
    if (useSessionStore.getState().isUserLaughing) {
      useSessionStore.getState().setIsUserLaughing(false);
    }
    if (laughDecayTimerRef.current) {
      clearTimeout(laughDecayTimerRef.current);
      laughDecayTimerRef.current = null;
    }
  }

  function clearSmile() {
    if (useSessionStore.getState().isUserSmiling) {
      useSessionStore.getState().setIsUserSmiling(false);
    }
    if (smileDecayTimerRef.current) {
      clearTimeout(smileDecayTimerRef.current);
      smileDecayTimerRef.current = null;
    }
  }

  // ─── Webcam + Vision ──────────────────────────────────────────────────────────

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
    if (!frame) {
      brainRef.current?.setCameraAvailable(false);
      useSessionStore.getState().logTiming("vision: no frame (camera not ready)");
      scheduleNextVision();
      return;
    }
    const { burnIntensity: bi, activePersona: ap } = useSessionStore.getState();
    useSessionStore.getState().setLastVisionCallTs(Date.now());
    const visionSpanId = useSessionStore.getState().beginSpan("vision", "analyze");
    fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64: frame, burnIntensity: bi, mode: "vision", persona: ap }),
      // Healthy /api/analyze round-trips run 5-9s on mobile prod (Gemini vision
      // + Vercel); 10s aborted real in-flight calls and spammed "signal timed
      // out" in session logs.
      signal: AbortSignal.timeout(15_000),
    })
      .then((r) => r.json())
      .then((d) => {
        useSessionStore.getState().endSpan(visionSpanId);
        const obs: string[] = d.observations ?? [];
        const setting: string | null = d.setting ?? null;
        useSessionStore.getState().logTiming(`vision: ${obs.length} obs — ${obs.join("; ").slice(0, 100)}${setting ? ` [${setting}]` : ""}`);
        if (obs.length) {
          useSessionStore.getState().setObservations(obs);
          brainRef.current?.onVisionUpdate(obs);
          detectExpression(obs);
        }
        if (setting) {
          useSessionStore.getState().setVisionSetting(setting);
        }
      })
      .catch((e) => {
        useSessionStore.getState().endSpan(visionSpanId);
        useSessionStore.getState().logTiming(`vision: ERROR — ${(e as Error).message}`);
      })
      .finally(() => {
        scheduleNextVision();
      });
  }

  /** Schedule next vision call after the configured interval. */
  function scheduleNextVision() {
    if (!isRunningRef.current) return;
    visionIntervalRef.current = setTimeout(runVisionAnalyze, COMEDIAN_CONFIG.visionIntervalMs);
  }

  function startVisionSend() {
    stopVisionSend();
    runVisionAnalyze();
  }

  function stopVisionSend() {
    if (visionIntervalRef.current) {
      clearTimeout(visionIntervalRef.current);
      visionIntervalRef.current = null;
    }
  }

  // ─── Session rotation ─────────────────────────────────────────────────────────

  // Guards against re-entrant rotation (e.g., a rotation triggered by an
  // unexpected onclose firing while another rotation is already in flight).
  const rotatingRef = useRef(false);
  // Tracks unexpected reconnects to avoid storming Gemini if its server keeps
  // dropping us. After this many failures in a 30s window, give up.
  const reconnectAttemptsRef = useRef<number[]>([]);

  // A pre-minted Gemini ephemeral token kept warm OFF the critical path, so a
  // reconnect (unexpected drop) or scheduled rotation doesn't have to wait on a
  // /api/live-token round-trip — the dominant cost when the socket drops early.
  // Consumed by rotateSession and immediately refilled. openSession's built-in
  // `fetchToken()` fallback covers the case where the spare is missing/expired.
  const spareTokenRef = useRef<Promise<string> | null>(null);
  function mintSpareToken() {
    // Hold the in-flight promise so a near-instant drop can await it rather than
    // starting a second fetch. Rejections are handled by openSession's fallback.
    spareTokenRef.current = fetchToken();
    // Swallow unhandled-rejection noise; the value is only consumed via openSession.
    spareTokenRef.current.catch(() => {});
  }

  async function rotateSession() {
    if (!isRunningRef.current) return;
    if (rotatingRef.current) return;
    rotatingRef.current = true;
    useSessionStore.getState().logTiming("live: rotating session");
    useSessionStore.getState().addConversationEvent("rotate");
    const rotateSpanId = useSessionStore.getState().beginSpan("session", "rotate");

    try {
      const oldSession = sessionRef.current;
      // Reconnect with the warm spare token if we have one (skips the live-token
      // round-trip on the critical path); openSession falls back to fetchToken if
      // it's null/expired. Refill the spare immediately for the next time.
      const tokenPromise = spareTokenRef.current;
      spareTokenRef.current = null;
      const newSession = await openSession(tokenPromise);
      mintSpareToken();
      sessionRef.current = newSession;
      useSessionStore.getState().endSpan(rotateSpanId);
      try { oldSession?.close(); } catch { /* may be closed */ }
      scheduleRotation();
      const frame = webcamRef.current?.captureFrame();
      if (frame) {
        newSession.sendRealtimeInput({ video: { data: frame, mimeType: "image/jpeg" } });
      }
    } catch (err) {
      console.error("[live] Rotation failed:", err);
      useSessionStore.getState().logTiming(`live: rotation error — ${(err as Error).message}`);
      useSessionStore.getState().endSpan(rotateSpanId);
    } finally {
      rotatingRef.current = false;
    }
  }

  /** Triggered by Gemini Live's onclose when the close was unexpected. */
  function reconnectAfterUnexpectedClose() {
    if (!isRunningRef.current || rotatingRef.current) return;
    const now = Date.now();
    reconnectAttemptsRef.current = reconnectAttemptsRef.current.filter((t) => now - t < 30_000);
    reconnectAttemptsRef.current.push(now);
    if (reconnectAttemptsRef.current.length > 4) {
      useSessionStore.getState().logTiming(
        `live: too many reconnects (${reconnectAttemptsRef.current.length} in 30s) — giving up`,
      );
      useSessionStore.getState().setError(
        "Connection to Gemini keeps dropping. Stop and try again.",
      );
      return;
    }
    useSessionStore.getState().logTiming(
      `live: unexpected close — reconnecting (attempt ${reconnectAttemptsRef.current.length})`,
    );
    void rotateSession();
  }

  function scheduleRotation() {
    if (rotateTimerRef.current) clearTimeout(rotateTimerRef.current);
    // Allow tests to inject a longer rotation timeout via window.__SESSION_ROTATE_MS__
    const rotateMsOverride = typeof window !== "undefined"
      ? (window as unknown as Record<string, unknown>).__SESSION_ROTATE_MS__
      : undefined;
    const rotateMs = typeof rotateMsOverride === "number" ? rotateMsOverride : SESSION_ROTATE_MS;

    // Skip rotation if the wrapup window is imminent — opening a new WebSocket only to
    // tear it down moments later wastes a connect and risks racing the wrapup TTS drain.
    if (kickoffTimeRef.current !== null) {
      const elapsed = Date.now() - kickoffTimeRef.current;
      if (elapsed + rotateMs >= COMEDIAN_CONFIG.wrapupGuardMs) {
        useSessionStore.getState().logTiming(
          `live: skipping rotation — wrapup imminent (elapsed=${(elapsed / 1000).toFixed(1)}s)`,
        );
        return;
      }
    }
    rotateTimerRef.current = setTimeout(rotateSession, rotateMs);
  }

  function scheduleWrapup() {
    if (wrapupTimerRef.current) clearTimeout(wrapupTimerRef.current);
    const ms = COMEDIAN_CONFIG.wrapupAfterMs;
    if (ms <= 0) return;
    wrapupTimerRef.current = setTimeout(() => {
      wrapupTimerRef.current = null;
      if (!isRunningRef.current) return;
      useSessionStore.getState().logTiming(
        `live: wrapup timer fired (${(ms / 1000).toFixed(0)}s elapsed) — requesting brain wrapup`,
      );
      brainRef.current?.requestWrapup();
    }, ms);
  }

  // ─── Audio stream for recording ────────────────────────────────────────────────

  function getRecordingAudioStream(): MediaStream | null {
    // Mix mic audio into the recording destination (TTS playback context).
    // Routes mic → dest node only (NOT speakers) to avoid feedback.
    const micStream = mic.getStream();
    if (micStream) {
      micRecordingDisconnectRef.current = playback.addInputToRecording(micStream);
    }
    return playback.getDestinationStream();
  }

  // ─── Mock session ──────────────────────────────────────────────────────────────

  async function startMockSession() {
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    isRunningRef.current = true;
    ttsChainRef.current = Promise.resolve();
    ttsGenerationRef.current++;


    userSpeakingSpanRef.current = null;
    geminiWaitingSpanRef.current = null;
    useSessionStore.getState().clearConversationEvents();
    useSessionStore.getState().clearTimelineSpans();
    useSessionStore.getState().clearTranscriptHistory();

    // Start immediately — puppet looks up and talks with no gaps
    useSessionStore.getState().setActiveMotionState("smug", 0.8);

    // AI-generated joke queue — refilled in the background as it empties
    const jokeQueue: string[] = [];
    let fetchInFlight = false;

    async function refillJokeQueue(): Promise<void> {
      if (fetchInFlight || !isRunningRef.current) return;
      fetchInFlight = true;
      try {
        const resp = await fetch("/api/generate-joke", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ context: "hopper", persona: "kvetch", burnIntensity: 3 }),
        });
        if (resp.ok) {
          const data = (await resp.json()) as { jokes?: { text: string }[] };
          const texts = (data.jokes ?? []).map((j) => j.text).filter(Boolean);
          jokeQueue.push(...texts);
        }
      } catch {
        // API unavailable — fall back to MOCK_LINES below
      } finally {
        fetchInFlight = false;
      }
    }

    // Pre-fetch before the loop starts so the first line is AI-generated
    await refillJokeQueue();

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (!isRunningRef.current) break;

      // Refill in the background when queue is getting low
      if (jokeQueue.length <= 1) void refillJokeQueue();

      // Use AI joke if available, otherwise fall back to hardcoded lines
      const line = jokeQueue.shift() ?? MOCK_LINES[Math.floor(Math.random() * MOCK_LINES.length)];

      const store = useSessionStore.getState();
      store.setIsSpeaking(true);
      store.setTranscript(line);

      const sentences = line.match(/[^.!?]+[.!?]+\s*/g) ?? [line];
      for (const s of sentences) queueSpeak(s);

      // Wait for TTS to finish decoding AND finish playing
      await ttsChainRef.current;
      while (!playback.isQueueEmpty() && isRunningRef.current) await sleep(50);
      if (!isRunningRef.current) break;

      store.setIsSpeaking(false);
      useSessionStore.getState().setActiveMotionState("smug", 0.8);
    }
  }

  // ─── Start / Stop ─────────────────────────────────────────────────────────────

  async function startLiveSession() {
    if (isRunningRef.current) return; // guard against React StrictMode double-invoke
    isRunningRef.current = true;

    // Warm up AudioContext immediately — on iOS Safari, creating the context close
    // to the user gesture ensures hardware volume buttons control Web Audio output.
    playback.warmUp();

    ttsChainRef.current = Promise.resolve();
    ttsGenerationRef.current++; // increment (not reset) — invalidates any in-flight TTS from prior session
    lastSpokenTextRef.current = ""; // reset vocal continuity context for new session

    userSpeakingSpanRef.current = null;
    geminiWaitingSpanRef.current = null;
    firstSpeechRecordedRef.current = false;
    micChunkLoggedRef.current = false;
    micSentLoggedRef.current = false;
    micBlockedLoggedRef.current = false;
    pendingVadStreamRef.current = null;
    vadStartRequestedRef.current = false;
    useSessionStore.getState().setError(null); // clear any prior quota/session error
    useSessionStore.getState().clearTimingLog();
    useSessionStore.getState().clearLlmLog();
    useSessionStore.getState().clearConversationEvents();
    useSessionStore.getState().clearTimelineSpans();
    useSessionStore.getState().clearTranscriptHistory();
    useSessionStore.getState().setTownFlavorBlurb(null);
    useSessionStore.getState().setTownFlavorRequested(false);
    useSessionStore.getState().logTiming("live: starting session");

    // Prefetch greeting: vision analyze first → then joke generation with observations.
    // This lets the greeting reference what the model actually sees ("nice beard", "that shirt").
    // Webcam startup can lag by a few hundred ms, so retry briefly before giving up.
    const captureGreetingFrame = async (): Promise<string | undefined> => {
      let frame = webcamRef.current?.captureFrame();
      if (frame) return frame;
      for (let i = 0; i < 3; i++) {
        await new Promise<void>((resolve) => setTimeout(resolve, 120));
        frame = webcamRef.current?.captureFrame();
        if (frame) {
          useSessionStore.getState().logTiming(`live: greeting frame became ready after retry ${i + 1}`);
          return frame;
        }
      }
      return undefined;
    };
    let greetingPrefetch: Promise<JokeResponse | null>;

    const cannedIntroActive = (() => {
      const s = useSessionStore.getState();
      return s.cannedIntro && s.experienceType === "roast";
    })();

    let cannedOpener: CannedOpenerPrefetch | null = null;
    if (cannedIntroActive) {
      // The brain opens with an instant canned line — an LLM greeting prefetch
      // would just be discarded, so don't spend the call. The opener's TTS was
      // prefetched in page.tsx during the permission window; fall back to firing
      // it here (still ahead of brain.start) if that warmup is missing/failed.
      greetingPrefetch = Promise.resolve(null);
      cannedOpener = (warmupCannedOpener ? await warmupCannedOpener.catch(() => null) : null)
        ?? prefetchCannedOpener();
      useSessionStore.getState().logTiming(
        `live: canned intro on — opener ${cannedOpener ? "TTS prefetched" : "unavailable (brain will pick)"}`,
      );
    } else if (warmupGreetingPrefetch) {
      greetingPrefetch = warmupGreetingPrefetch.catch(() => null);
      useSessionStore.getState().logTiming("live: using pre-roast greeting warmup");
    } else {
      const greetingFrame = await captureGreetingFrame();
      const greetingStore = useSessionStore.getState();
      useSessionStore.getState().logTiming(`live: greeting prefetch — frame=${greetingFrame ? "yes" : "no"}`);

      greetingPrefetch = prefetchParallelVisionAndGreeting(greetingFrame, {
        activePersona: greetingStore.activePersona,
        burnIntensity: greetingStore.burnIntensity,
        contentMode: greetingStore.contentMode,
      }).catch(() => null);
      useSessionStore.getState().logTiming("live: greeting prefetch fired (parallel vision + joke)");
    }

    // Build ComedianBrain
    brainRef.current = new ComedianBrain({
      queueSpeak,
      openJokeStream,
      cancelSpeech,
      isQueueEmpty: () => playback.isQueueEmpty(),
      setMotion: (state, intensity) =>
        useSessionStore.getState().setActiveMotionState(state, intensity),
      captureFrame: () => webcamRef.current?.captureFrame() ?? undefined,
      getPersona: () => useSessionStore.getState().activePersona,
      getBurnIntensity: () => useSessionStore.getState().burnIntensity,
      getContentMode: () => useSessionStore.getState().contentMode,
      getRoastModel: () => useSessionStore.getState().roastModel,
      getCannedIntro: () => useSessionStore.getState().cannedIntro,
      getLlmQuestions: () => useSessionStore.getState().llmQuestions,
      getExperienceType: () => useSessionStore.getState().experienceType,
      getInputAmplitude: () => mic.getInputAmplitude(),
      getObservations: () => useSessionStore.getState().observations,
      getVisionSetting: () => useSessionStore.getState().visionSetting,
      getAmbientContext: () => useSessionStore.getState().ambientContext,
      getTownFlavor: () => useSessionStore.getState().townFlavorBlurb,
      getVoiceSettings: () => useSessionStore.getState().voiceSettings,
      getSessionId: () => comedianSessionIdRef.current,
      setBrainState: (s) => useSessionStore.getState().setBrainState(s),
      setCurrentQuestion: (q) => useSessionStore.getState().setCurrentQuestion(q),
      setUserAnswer: (a) => useSessionStore.getState().setUserAnswer(a),
      logTiming: (e) => useSessionStore.getState().logTiming(e),
      logLlm: (dir, label, text) => useSessionStore.getState().pushLlmLog(dir, label, text),
      setError: (e) => useSessionStore.getState().setError(e),
      // Generation hang or 503: the brain already spoke the busted line + is
      // ending the session. Surface the "restart with a different model?" prompt.
      onModelTrouble: (failedModel) => promptModelRestart(failedModel),
      revealSession: () => useSessionStore.getState().setHasSpokenThisSession(true),
      prefetchedGreeting: greetingPrefetch,
      prefetchedGreetingAudio: warmupGreetingAudio ?? undefined,
      prefetchedCannedOpener: cannedOpener ?? undefined,
      playPrefetchedAudio,
      saveCritique: (text, ctx) => {
        fetch("/api/save-feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "critique",
            text,
            persona: ctx.persona,
            lastJokeText: ctx.lastJokeText,
          }),
        }).catch(() => {});
      },
      onSessionEnd: () => {
        if (!isRunningRef.current) return;
        const store = useSessionStore.getState();
        const pauseMs = COMEDIAN_CONFIG.wrapupPostLinePauseMs;
        const fadeMs = 600;
        store.logTiming(
          `live: wrapup complete — holding ${pauseMs}ms before fade, then stopping`,
        );

        // Beat of silence: hold the puppet on stage for a few seconds after the goodbye,
        // then quick fade to black, then phase transition.
        setTimeout(() => {
          if (!isRunningRef.current) return;
          useSessionStore.getState().setIsEnding(true);
          useSessionStore.getState().setPuppetRevealed(false);
          setTimeout(() => {
            if (useSessionStore.getState().phase === "roasting") {
              useSessionStore.getState().setPhase("stopped", "SESSION_TIMEOUT");
            }
          }, fadeMs + 50);
        }, pauseMs);
      },
    });

    // Start the comedy show: reset per-session metrics/flags and kick the brain.
    // Idempotent — the canned-intro path calls it BEFORE the Gemini connect,
    // the normal path after; whichever runs first wins.
    let brainShowStarted = false;
    const startBrainShow = () => {
      if (brainShowStarted || !isRunningRef.current || !brainRef.current) return;
      brainShowStarted = true;
      kickoffTimeRef.current = Date.now();
      useSessionStore.getState().setTimeToFirstSpeechMs(null);
      useSessionStore.getState().setHasSpokenThisSession(false);
      // puppetRevealed flips on the first queued audio chunk so setup stays behind loading.
      useSessionStore.getState().setIsEnding(false);
      if (!webcamRef.current?.captureFrame()) brainRef.current.setCameraAvailable(false);
      // Recording is started lazily by startVideoRecordingIfNeeded() at the
      // moment the puppet is revealed — see scheduleFromPrefetch. This keeps
      // greeting LLM/TTS prefetch latency out of the front of the MP4.
      startDrainPolling();
      brainRef.current.start();
      kickTownFlavorFetch(); // overlaps first-joke TTS when geo already resolved
      useSessionStore.getState().logTiming("live: brain started");
    };

    const connectSpanId = useSessionStore.getState().beginSpan("session", "connect");
    try {
      const sessionPromise = openSession(prefetchedTokenPromise);
      const micPromise = mic.start(mediaStream).catch((e) => {
        console.warn("[live] mic start failed:", e);
        useSessionStore.getState().logTiming(`live: mic failed — ${(e as Error).name || "unknown"}`);
        brainRef.current?.setMicAvailable(false);
      });

      // Canned intro needs NO Gemini Live: the opener is a canned line + TTS, and
      // the mic/STT isn't needed until wait_answer (~10s in — the WS will be open
      // long before). Waiting for the connect added seconds of dead air on mobile
      // before a line that's supposed to be instant.
      if (cannedIntroActive) {
        useSessionStore.getState().logTiming("live: canned intro — starting show before Gemini connect");
        startBrainShow();
      }

      // Comedian chat session: prefer the one pre-created at button press (its
      // cold latency overlapped the permission grant). Fall back to creating it
      // here if the prefetch is missing or resolved null. Non-blocking either
      // way — the brain falls back to stateless if no sessionId ever lands.
      const store = useSessionStore.getState();
      const createComedianSession = (): Promise<string | null> =>
        fetch("/api/comedian-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            persona: store.activePersona,
            burnIntensity: store.burnIntensity,
            contentMode: store.contentMode,
            model: store.roastModel,
            experienceType: store.experienceType,
          }),
        })
          .then((r) => r.json())
          .then((data: { sessionId?: string }) => data.sessionId ?? null)
          .catch(() => null);

      (prefetchedComedianSessionPromise ?? createComedianSession())
        .then((sessionId) => {
          // Prefetch may resolve null (failed) — create one here as a fallback.
          if (!sessionId && prefetchedComedianSessionPromise) return createComedianSession();
          return sessionId;
        })
        .then((sessionId) => {
          if (sessionId && isRunningRef.current) {
            comedianSessionIdRef.current = sessionId;
            useSessionStore.getState().logTiming(`live: comedian chat session ready (${sessionId}) model=${store.roastModel} experience=${store.experienceType}`);
          }
        })
        .catch(() => { /* stateless fallback — no action needed */ });

      const session = await sessionPromise;

      // Guard: stopLiveSession() may have run while we were awaiting (e.g. user
      // clicked Stop, then immediately Start Session before the old stop finished).
      if (!isRunningRef.current || !brainRef.current) {
        try { session.close(); } catch { /* noop */ }
        useSessionStore.getState().endSpan(connectSpanId);
        return;
      }

      sessionRef.current = session;
      useSessionStore.getState().endSpan(connectSpanId);
      useSessionStore.getState().logTiming("live: session ready (mic init in background)");

      // Start the comedy show NOW — don't wait for mic to finish initializing.
      // Greeting + first question are TTS-only; mic isn't needed until wait_answer
      // (~10s later). Pulls TTFS down by the mic init time (~3s). No-op when the
      // canned-intro path already started the show before the connect.
      startBrainShow();

      // Mic + VAD setup in background — won't block first speech.
      micPromise.then(() => {
        if (!isRunningRef.current || !brainRef.current) return;
        useSessionStore.getState().logTiming("live: mic ready");
        const micStream = mic.getStream();
        if (micStream) {
          useSessionStore.getState().logTiming(
            `mic: stream ready (${micStream.getAudioTracks().length} audio tracks)`,
          );
          micRecordingDisconnectRef.current = playback.addInputToRecording(micStream);
          pendingVadStreamRef.current = micStream;
          useSessionStore.getState().logTiming("vad: waiting until first speech");
          startVadWhenSafe();
        } else {
          brainRef.current?.setVadAvailable(false);
        }
      });

      // Send first webcam frame to Gemini for VAD context
      const firstFrame = webcamRef.current?.captureFrame();
      if (firstFrame) {
        session.sendRealtimeInput({ video: { data: firstFrame, mimeType: "image/jpeg" } });
        useSessionStore.getState().logTiming("live: initial frame sent");
      }

      startWebcamSend();
      scheduleRotation();
      // Warm a spare token now so the first rotation / an early unexpected drop
      // reconnects without a token round-trip on the critical path.
      mintSpareToken();
      scheduleWrapup();
      startVisionSend();
    } catch (err) {
      console.error("[live] Failed to start:", err);
      useSessionStore.getState().logTiming(`live: start error — ${(err as Error).message}`);
      useSessionStore.getState().endSpan(connectSpanId);
      useSessionStore.getState().setError(
        `Live session failed: ${(err as Error).message}. Try monologue mode.`,
      );
      useSessionStore.getState().setPhase("idle", "ERROR");
    }
  }

  async function stopLiveSession() {
    isRunningRef.current = false;

    // Stop brain
    brainRef.current?.stop();
    brainRef.current = null;

    stopDrainPolling();

    // Close timeline spans
    const store = useSessionStore.getState();
    if (userSpeakingSpanRef.current) { store.endSpan(userSpeakingSpanRef.current); userSpeakingSpanRef.current = null; }
    if (geminiWaitingSpanRef.current) { store.endSpan(geminiWaitingSpanRef.current); geminiWaitingSpanRef.current = null; }

    store.setHasSpokenThisSession(false);
    store.setPuppetRevealed(false);

    stopWebcamSend();
    stopVisionSend();
    if (rotateTimerRef.current) clearTimeout(rotateTimerRef.current);
    if (wrapupTimerRef.current) { clearTimeout(wrapupTimerRef.current); wrapupTimerRef.current = null; }

    cancelSpeech();
    micRecordingDisconnectRef.current?.();
    micRecordingDisconnectRef.current = null;
    pendingVadStreamRef.current = null;
    vadStartRequestedRef.current = false;
    vad.stop();
    mic.stop();
    playback.flush();

    try { sessionRef.current?.close(); } catch { /* may be closed */ }
    sessionRef.current = null;
    spareTokenRef.current = null; // drop any warm spare; it'll expire on its own

    // Clean up comedian chat session (fire-and-forget)
    if (comedianSessionIdRef.current) {
      fetch("/api/comedian-session", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: comedianSessionIdRef.current }),
      }).catch(() => {});
      comedianSessionIdRef.current = null;
    }

    store.setIsSpeaking(false);
    store.setIsListening(false);
    store.setIsUserSpeaking(false);
    store.setActiveMotionState("idle", 0.3);

    if (videoRecorderRef.current) {
      try {
        const blob = await videoRecorderRef.current.stop();
        store.logTiming(`live: recording stopped (${blob.size} bytes, ${blob.type || "unknown"})`);
        store.setRecordedBlob(blob);
      } catch (err) {
        console.error("[live] Recording stop error:", err);
        store.logTiming(`live: recording stop error — ${(err as Error).message}`);
      }
    }

    // Only navigate to sharing if the user hasn't already moved on (e.g. clicked
    // "Start Session" again before this async stop finished). When a model-trouble
    // prompt is up, DON'T auto-navigate to the share screen behind it — the modal
    // owns where we go next (restart with a different model, or back to landing).
    if (useSessionStore.getState().phase === "stopped" && !useSessionStore.getState().modelUnavailable) {
      store.setPhase("sharing", "SHARE_CLICKED");
    }

    // Auto-save transcript for debugging
    saveTranscript(store);
  }

  function saveTranscript(store: ReturnType<typeof useSessionStore.getState>): void {
    const payload = {
      savedAt: new Date().toISOString(),
      transcriptHistory: store.transcriptHistory,
      timingLog: store.timingLog,
      observations: store.observations,
      timeToFirstSpeechMs: store.timeToFirstSpeechMs,
      activePersona: store.activePersona,
      burnIntensity: store.burnIntensity,
      sessionMode: store.sessionMode,
    };
    // Local dev: write to .debug/ on disk for fast inspection (no-ops on Vercel — read-only fs)
    fetch("/api/save-transcript", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch((e) => console.warn("[save-transcript] failed:", e));
    // Production: also push to Vercel Blob via save-feedback so debugging a Vercel session
    // doesn't require the user to fill out the FeedbackBox. Skip empty sessions.
    if (store.timingLog.length > 0 || store.transcriptHistory.length > 0) {
      fetch("/api/save-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "session-log",
          persona: store.activePersona,
          sessionLog: payload,
        }),
      }).catch((e) => console.warn("[save-feedback session-log] failed:", e));
    }
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (phase === "roasting") {
      mockMode ? startMockSession() : startLiveSession();
    } else if (phase === "stopped") {
      stopLiveSession();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Cleanup on real unmount (navigation away, etc.). Keep this LIGHT — only
  // clear timers/intervals. The phase effect above drives the full shutdown
  // through stopLiveSession when phase flips to "stopped". Heavy teardown here
  // (mic.stop / vad.stop / playback.flush / session.close) used to fire during
  // React StrictMode's simulated unmount/remount in dev: the cleanup killed
  // the mic stream, but isRunningRef stayed true so the remount's
  // startLiveSession early-exited — leaving an in-progress micPromise that
  // resolved against a dead stream and never produced PCM chunks.
  useEffect(() => {
    return () => {
      stopDrainPolling();
      stopWebcamSend();
      stopVisionSend();
      if (rotateTimerRef.current) clearTimeout(rotateTimerRef.current);
      if (wrapupTimerRef.current) clearTimeout(wrapupTimerRef.current);
      if (userSpeakingTimerRef.current) clearTimeout(userSpeakingTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
