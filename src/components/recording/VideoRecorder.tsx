"use client";
import { useRef, useImperativeHandle, forwardRef } from "react";

export interface VideoRecorderHandle {
  start(compositorStream: MediaStream, audioStream: MediaStream | null): void;
  stop(): Promise<Blob>;
}

const VideoRecorder = forwardRef<VideoRecorderHandle>(function VideoRecorder(_props, ref) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useImperativeHandle(ref, () => ({
    start(compositorStream: MediaStream, audioStream: MediaStream | null) {
      chunksRef.current = [];

      const tracks = [...compositorStream.getVideoTracks()];
      if (audioStream) {
        audioStream.getAudioTracks().forEach((t) => tracks.push(t));
      }
      const combined = new MediaStream(tracks);

      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm";

      const recorder = new MediaRecorder(combined, { mimeType });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.start(100); // collect every 100ms
      recorderRef.current = recorder;
    },

    stop(): Promise<Blob> {
      return new Promise((resolve) => {
        const recorder = recorderRef.current;
        if (!recorder || recorder.state === "inactive") {
          resolve(new Blob(chunksRef.current, { type: "video/webm" }));
          return;
        }
        recorder.onstop = () => {
          resolve(new Blob(chunksRef.current, { type: "video/webm" }));
        };
        recorder.stop();
      });
    },
  }));

  return null;
});

export default VideoRecorder;
