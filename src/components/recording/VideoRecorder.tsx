"use client";
import { useRef, useImperativeHandle, forwardRef } from "react";
import {
  chooseRecorderFormat,
  recommendedVideoBitsPerSecond,
  RECOMMENDED_AUDIO_BITS_PER_SECOND,
} from "@/lib/mediaRecorderSupport";

export interface VideoRecorderHandle {
  start(
    compositorStream: MediaStream,
    audioStream: MediaStream | null,
    dimensions?: { width: number; height: number },
  ): void;
  stop(): Promise<Blob>;
  isRecording(): boolean;
}

const VideoRecorder = forwardRef<VideoRecorderHandle>(function VideoRecorder(_props, ref) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef("video/mp4");

  useImperativeHandle(ref, () => ({
    start(
      compositorStream: MediaStream,
      audioStream: MediaStream | null,
      dimensions?: { width: number; height: number },
    ) {
      // Guard against double-start (React StrictMode fires effects twice in dev)
      if (recorderRef.current?.state === "recording") return;
      chunksRef.current = [];

      const videoTracks = compositorStream.getVideoTracks();
      const audioTracks = audioStream?.getAudioTracks() ?? [];

      const tracks = [...videoTracks, ...audioTracks];
      if (tracks.length === 0) {
        console.error("[recorder] no tracks — recording aborted");
        return;
      }
      const combined = new MediaStream(tracks);
      const format = chooseRecorderFormat();
      if (!format) {
        // No MP4 candidate supported — surface a clear console error and bail
        // rather than silently fall back to WebM (Vercel Hobby can't convert).
        // isMp4RecordingSupported() should have gated the session before we
        // ever got here.
        console.error(
          "[recorder] browser MediaRecorder does not support MP4 — recording aborted",
        );
        return;
      }
      const videoSettings = videoTracks[0]?.getSettings();
      const width = dimensions?.width ?? videoSettings?.width ?? 720;
      const height = dimensions?.height ?? videoSettings?.height ?? 720;
      const videoBitsPerSecond = recommendedVideoBitsPerSecond(width, height);

      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(combined, {
          mimeType: format.mimeType,
          videoBitsPerSecond,
          audioBitsPerSecond: RECOMMENDED_AUDIO_BITS_PER_SECOND,
        });
      } catch {
        recorder = new MediaRecorder(combined, { mimeType: format.mimeType });
      }
      mimeTypeRef.current = recorder.mimeType || format.mimeType;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onerror = (e) => console.error("[recorder] error:", e);
      recorder.start(1000);
      recorderRef.current = recorder;
      console.info(
        `[recorder] started mime=${mimeTypeRef.current} size=${width}x${height} video=${videoTracks.length} audio=${audioTracks.length} vbps=${videoBitsPerSecond} abps=${RECOMMENDED_AUDIO_BITS_PER_SECOND}`,
      );
    },

    stop(): Promise<Blob> {
      return new Promise((resolve) => {
        const recorder = recorderRef.current;
        if (!recorder || recorder.state === "inactive") {
          resolve(new Blob(chunksRef.current, { type: mimeTypeRef.current }));
          return;
        }
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          recorderRef.current = null;
          // Always tag the blob as video/mp4 — the recorder produces MP4 only
          // and some browsers report an empty mimeType after stop().
          const blob = new Blob(chunksRef.current, { type: "video/mp4" });
          console.info(`[recorder] stopped chunks=${chunksRef.current.length} size=${blob.size}`);
          resolve(blob);
        };
        recorder.onstop = () => {
          finish();
        };
        recorder.onerror = (e) => {
          console.error("[recorder] stop error:", e);
          finish();
        };
        try {
          recorder.requestData();
        } catch {
          // Some browsers throw if requestData races with stop; onstop still resolves.
        }
        try {
          recorder.stop();
        } catch {
          finish();
        }
        window.setTimeout(finish, 3000);
      });
    },

    isRecording(): boolean {
      return recorderRef.current?.state === "recording";
    },
  }));

  return null;
});

export default VideoRecorder;
