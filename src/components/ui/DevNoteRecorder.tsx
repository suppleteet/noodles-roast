"use client";
import { useEffect, useRef, useState } from "react";
import { useSessionStore } from "@/store/useSessionStore";
import { useVoiceNoteRecorder } from "@/components/audio/useVoiceNoteRecorder";

interface Props {
  mode: "gesture" | "session-end";
  jokeContext?: string;
}

/** Sends audio + session log to server for Gemini transcription. */
async function saveNote(blob: Blob, index: number, context: string, sessionTs: number) {
  const store = useSessionStore.getState();
  const sessionLog = {
    transcriptHistory: store.transcriptHistory,
    timingLog: store.timingLog,
    observations: store.observations,
    visionSetting: store.visionSetting,
    brainState: store.brainState,
    activePersona: store.activePersona,
    burnIntensity: store.burnIntensity,
    sessionMode: store.sessionMode,
    timeToFirstSpeechMs: store.timeToFirstSpeechMs,
  };

  const form = new FormData();
  form.append("audio", blob, "note.webm");
  form.append("context", context.slice(0, 200));
  form.append("index", String(index));
  form.append("sessionTs", String(sessionTs));
  form.append("sessionLog", JSON.stringify(sessionLog));

  try {
    await fetch("/api/save-voice-note", { method: "POST", body: form });
  } catch (e) {
    console.error("[DevNoteRecorder] save failed", e);
  }
}

export default function DevNoteRecorder({ mode, jokeContext }: Props) {
  const brainState = useSessionStore((s) => s.brainState);
  const sessionStartTs = useSessionStore((s) => s.sessionStartTs);
  const devNoteCount = useSessionStore((s) => s.devNoteCount);
  const { isRecording, startRecording, stopRecording } = useVoiceNoteRecorder();
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const savedRef = useRef(false); // prevent double-save

  // Gesture mode: auto-start recording on mount
  useEffect(() => {
    if (mode !== "gesture") return;
    savedRef.current = false;
    startRecording().catch(console.error);
  }, [mode, startRecording]);

  // Elapsed timer
  useEffect(() => {
    if (isRecording) {
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording]);

  // Gesture mode: auto-stop when brain leaves dev_note (thumbs-up or timeout)
  useEffect(() => {
    if (mode !== "gesture") return;
    if (brainState !== "dev_note" && isRecording && !savedRef.current) {
      savedRef.current = true;
      stopRecording().then((blob) => {
        if (blob && blob.size > 0) {
          useSessionStore.getState().incrementDevNoteCount();
          saveNote(blob, devNoteCount, jokeContext ?? "gesture", sessionStartTs ?? 0);
        }
      });
    }
  }, [brainState, mode, isRecording, stopRecording, devNoteCount, jokeContext, sessionStartTs]);

  // Manual stop (fallback button or session-end mode)
  async function handleToggle() {
    if (isRecording) {
      const blob = await stopRecording();
      if (blob && blob.size > 0) {
        useSessionStore.getState().incrementDevNoteCount();
        await saveNote(blob, devNoteCount, jokeContext ?? "session-end", sessionStartTs ?? 0);
      }
      if (mode === "gesture") {
        useSessionStore.getState().requestDevNoteResume();
      }
    } else {
      await startRecording();
    }
  }

  // Skip (gesture mode only) — resume without recording
  function handleSkip() {
    if (isRecording) {
      stopRecording(); // discard
    }
    useSessionStore.getState().requestDevNoteResume();
  }

  const fmt = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;

  // ─── Gesture mode overlay ──────────────────────────────────────────────────

  if (mode === "gesture") {
    return (
      <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/60">
        <div className="flex flex-col items-center gap-3">
          {/* Pulsing red dot + timer */}
          <div className="flex items-center gap-2 text-white text-sm">
            <span className="inline-block w-3 h-3 rounded-full bg-red-500 animate-pulse" />
            <span>Recording note {fmt}</span>
          </div>

          {/* Manual stop button */}
          <button
            onClick={handleToggle}
            className="px-5 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl font-bold transition-colors"
          >
            Stop &amp; Resume
          </button>

          {/* Skip */}
          <button
            onClick={handleSkip}
            className="text-gray-400 hover:text-white text-xs transition-colors"
          >
            Skip (discard note)
          </button>

          <p className="text-gray-500 text-xs mt-2">
            or thumbs up to stop
          </p>
        </div>
      </div>
    );
  }

  // ─── Session-end mode (ShareScreen) ────────────────────────────────────────

  return (
    <div className="flex items-center justify-center gap-3 my-3">
      <button
        onClick={handleToggle}
        className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold transition-colors ${
          isRecording
            ? "bg-red-600 hover:bg-red-500 text-white"
            : "bg-gray-700 hover:bg-gray-600 text-white"
        }`}
      >
        {isRecording ? (
          <>
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-white animate-pulse" />
            Stop Note {fmt}
          </>
        ) : (
          <>
            <MicIcon />
            Leave Feedback
          </>
        )}
      </button>
    </div>
  );
}

function MicIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
      <path d="M12 1a4 4 0 0 0-4 4v6a4 4 0 0 0 8 0V5a4 4 0 0 0-4-4Z" />
      <path d="M6 10a1 1 0 0 0-2 0 8 8 0 0 0 7 7.93V21H8a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-3.07A8 8 0 0 0 20 10a1 1 0 1 0-2 0 6 6 0 0 1-12 0Z" />
    </svg>
  );
}
