"use client";
import { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import { COMPOSITOR_SIZE } from "@/lib/constants";
import { centerCropSquare } from "@/lib/videoUtils";

export interface WebcamCaptureHandle {
  captureFrame(): string | null;
  getVideoElement(): HTMLVideoElement | null;
}

interface Props {
  stream: MediaStream | null;
}

const WebcamCapture = forwardRef<WebcamCaptureHandle, Props>(function WebcamCapture(
  { stream },
  ref
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!videoRef.current || !stream) return;
    videoRef.current.srcObject = stream;
    videoRef.current.play().catch(() => {});
  }, [stream]);

  useImperativeHandle(ref, () => ({
    captureFrame(): string | null {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2) return null;

      const size = COMPOSITOR_SIZE;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;

      const { side, sx, sy } = centerCropSquare(video.videoWidth, video.videoHeight);
      ctx.drawImage(video, sx, sy, side, side, 0, 0, size, size);

      return canvas.toDataURL("image/jpeg", 0.6).split(",")[1];
    },
    getVideoElement(): HTMLVideoElement | null {
      return videoRef.current;
    },
  }));

  return (
    <>
      <video ref={videoRef} muted playsInline className="hidden" aria-hidden="true" />
      <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
    </>
  );
});

export default WebcamCapture;
