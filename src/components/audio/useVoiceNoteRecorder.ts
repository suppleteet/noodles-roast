"use client";
import { useRef, useState, useCallback } from "react";

/**
 * Simple MediaRecorder-based hook for recording voice notes.
 * Separate from useMicCapture (which is AudioWorklet-based for Gemini STT).
 */
export function useVoiceNoteRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startRecording = useCallback(async () => {
    if (recorderRef.current) return; // already recording

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    chunksRef.current = [];

    // Pick a supported MIME type
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : ""; // browser default

    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.start(200); // 200ms chunks
    recorderRef.current = recorder;
    setIsRecording(true);
  }, []);

  const stopRecording = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const recorder = recorderRef.current;
      if (!recorder || recorder.state === "inactive") {
        resolve(null);
        return;
      }

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        chunksRef.current = [];
        recorderRef.current = null;
        // Release mic stream
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setIsRecording(false);
        resolve(blob);
      };

      recorder.stop();
    });
  }, []);

  return { isRecording, startRecording, stopRecording } as const;
}
