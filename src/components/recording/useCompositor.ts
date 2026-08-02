import { useEffect, useRef } from "react";
import {
  containRecordingRect,
  coverSourceRect,
  mapElementToRecording,
  recordingSizeForFrame,
  type RecordingRect,
} from "@/lib/recordingLayout";
import { useSessionStore } from "@/store/useSessionStore";

export interface PreparedCompositor {
  stream: MediaStream;
  width: number;
  height: number;
}

export interface CompositorHandle {
  canvas: HTMLCanvasElement | null;
  stream: MediaStream | null;
  prepareForRecording(): PreparedCompositor | null;
}

function rectOf(rect: DOMRect): RecordingRect {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function roundedPath(
  ctx: CanvasRenderingContext2D,
  rect: RecordingRect,
  radius: number,
): void {
  ctx.beginPath();
  ctx.roundRect(
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    Math.max(0, Math.min(radius, rect.width / 2, rect.height / 2)),
  );
}

function truncateText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let shortened = text;
  while (shortened.length > 1 && ctx.measureText(`${shortened}…`).width > maxWidth) {
    shortened = shortened.slice(0, -1);
  }
  return `${shortened.trimEnd()}…`;
}

/**
 * Draws the same responsive call composition the user sees into a captureStream:
 * puppet stage, mirrored self-view, live HUD/vignette, and the end-call control.
 * Encoder dimensions are frozen when recording starts; later rotation is contained
 * inside that stable frame so Android MP4 encoders never see a mid-stream resize.
 */
export function useCompositor(
  puppetCanvasRef: React.RefObject<HTMLCanvasElement | null>,
  webcamVideoRef: React.RefObject<HTMLVideoElement | null>,
  callFrameRef: React.RefObject<HTMLElement | null>,
  selfViewRef: React.RefObject<HTMLVideoElement | null>,
  callControlsRef: React.RefObject<HTMLDivElement | null>,
  endButtonRef: React.RefObject<HTMLButtonElement | null>,
): React.MutableRefObject<CompositorHandle> {
  const configureRef = useRef<(lock: boolean) => PreparedCompositor | null>(() => null);
  const handle = useRef<CompositorHandle>({
    canvas: null,
    stream: null,
    prepareForRecording: () => configureRef.current(true),
  });
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 720;
    canvas.height = 720;
    const stream = canvas.captureStream(30);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    let layoutLocked = false;
    let previousRevealed = false;
    let previousEnding = false;
    let revealStartedAt: number | null = null;
    let endingStartedAt: number | null = null;
    const hangupPath = new Path2D(
      "M6.6 10.8c3.48-2.15 7.32-2.15 10.8 0l1.26-1.72a1.55 1.55 0 0 1 2.16-.34l1.17.86c.68.5.83 1.45.34 2.13l-2.2 3a1.55 1.55 0 0 1-2.13.36l-1.16-.82a1.52 1.52 0 0 1-.54-1.76 8.85 8.85 0 0 0-8.6 0 1.52 1.52 0 0 1-.54 1.76L6 15.09a1.55 1.55 0 0 1-2.13-.36l-2.2-3a1.54 1.54 0 0 1 .34-2.13l1.17-.86a1.55 1.55 0 0 1 2.16.34L6.6 10.8Z",
    );

    const configure = (lock: boolean): PreparedCompositor | null => {
      const frame = callFrameRef.current?.getBoundingClientRect();
      const size = recordingSizeForFrame(frame?.width ?? 0, frame?.height ?? 0);
      if (canvas.width !== size.width || canvas.height !== size.height) {
        canvas.width = size.width;
        canvas.height = size.height;
      }
      if (lock) layoutLocked = true;
      return { stream, width: canvas.width, height: canvas.height };
    };

    configureRef.current = configure;
    handle.current.canvas = canvas;
    handle.current.stream = stream;
    configure(false);

    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          if (!layoutLocked) configure(false);
        });
    if (callFrameRef.current) observer?.observe(callFrameRef.current);

    const draw = () => {
      const frameElement = callFrameRef.current;
      const frameDomRect = frameElement?.getBoundingClientRect();
      const frameRect = frameDomRect && frameDomRect.width > 0 && frameDomRect.height > 0
        ? rectOf(frameDomRect)
        : { x: 0, y: 0, width: canvas.width, height: canvas.height };
      const recordingFrame = containRecordingRect(
        frameRect.width,
        frameRect.height,
        canvas.width,
        canvas.height,
      );
      const scale = recordingFrame.width / Math.max(1, frameRect.width);
      const frameRadiusCss = frameElement
        ? Number.parseFloat(getComputedStyle(frameElement).borderTopLeftRadius) || 0
        : 0;
      const frameRadius = frameRadiusCss * scale;

      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      roundedPath(ctx, recordingFrame, frameRadius);
      ctx.clip();

      const puppetCanvas = puppetCanvasRef.current;
      if (puppetCanvas && puppetCanvas.width > 0 && puppetCanvas.height > 0) {
        try {
          ctx.drawImage(
            puppetCanvas,
            recordingFrame.x,
            recordingFrame.y,
            recordingFrame.width,
            recordingFrame.height,
          );
        } catch {
          ctx.fillStyle = "#180800";
          ctx.fillRect(recordingFrame.x, recordingFrame.y, recordingFrame.width, recordingFrame.height);
        }
      } else {
        ctx.fillStyle = "#180800";
        ctx.fillRect(recordingFrame.x, recordingFrame.y, recordingFrame.width, recordingFrame.height);
      }

      // Match the live call's lower vignette instead of adding recording-only branding.
      const vignette = ctx.createLinearGradient(
        0,
        recordingFrame.y + recordingFrame.height * 0.55,
        0,
        recordingFrame.y + recordingFrame.height,
      );
      vignette.addColorStop(0, "rgba(0,0,0,0)");
      vignette.addColorStop(1, "rgba(0,0,0,0.62)");
      ctx.fillStyle = vignette;
      ctx.fillRect(recordingFrame.x, recordingFrame.y, recordingFrame.width, recordingFrame.height);

      const state = useSessionStore.getState();
      const now = performance.now();
      if (state.puppetRevealed && !previousRevealed) revealStartedAt = now;
      if (!state.puppetRevealed) revealStartedAt = null;
      if (state.isEnding && !previousEnding) endingStartedAt = now;
      if (!state.isEnding) endingStartedAt = null;
      previousRevealed = state.puppetRevealed;
      previousEnding = state.isEnding;

      let blackAlpha = state.puppetRevealed ? 0 : 1;
      if (state.puppetRevealed && revealStartedAt !== null) {
        blackAlpha = Math.max(0, 1 - (now - revealStartedAt) / 500);
      }
      if (state.isEnding && endingStartedAt !== null) {
        blackAlpha = Math.max(blackAlpha, Math.min(1, (now - endingStartedAt) / 600));
      }
      if (blackAlpha > 0.001) {
        ctx.fillStyle = `rgba(0,0,0,${blackAlpha.toFixed(3)})`;
        ctx.fillRect(recordingFrame.x, recordingFrame.y, recordingFrame.width, recordingFrame.height);
      }

      if (state.phase === "roasting" && !state.puppetRevealed) {
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.font = `600 ${Math.max(12, 14 * scale)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(
          "Connecting…",
          recordingFrame.x + recordingFrame.width / 2,
          recordingFrame.y + recordingFrame.height / 2 + 22 * scale,
        );
      }

      // Production HUD: same top-left live status and top-right heard text.
      if (state.phase === "roasting" || state.phase === "stopped") {
        const hudX = recordingFrame.x + 16 * scale;
        const hudY = recordingFrame.y + 20 * scale;
        ctx.fillStyle = state.phase === "roasting" ? "#ef4444" : "#6b7280";
        ctx.beginPath();
        ctx.arc(hudX + 4 * scale, hudY, 4 * scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.72)";
        ctx.font = `700 ${Math.max(10, 12 * scale)}px sans-serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(
          state.phase === "roasting" ? "LIVE · CONVERSATION" : "STOPPED · CONVERSATION",
          hudX + 14 * scale,
          hudY,
        );

        if (
          state.phase === "roasting" &&
          state.userAnswer &&
          ["wait_answer", "prodding", "pre_generate", "generating"].includes(state.brainState ?? "")
        ) {
          ctx.fillStyle = "rgba(255,255,255,0.42)";
          ctx.font = `400 ${Math.max(9, 11 * scale)}px sans-serif`;
          ctx.textAlign = "right";
          ctx.fillText(
            truncateText(ctx, state.userAnswer, 200 * scale),
            recordingFrame.x + recordingFrame.width - 16 * scale,
            recordingFrame.y + 20 * scale,
          );
        }
      }

      // Mirrored self-view, mapped from its actual responsive DOM rectangle.
      const video = webcamVideoRef.current;
      const selfView = selfViewRef.current;
      if (selfView) {
        const pip = mapElementToRecording(frameRect, rectOf(selfView.getBoundingClientRect()), recordingFrame);
        const pipRadiusCss = Number.parseFloat(getComputedStyle(selfView).borderTopLeftRadius) || 0;
        const pipRadius = pipRadiusCss * scale;
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.42)";
        ctx.shadowBlur = 24 * scale;
        ctx.shadowOffsetY = 10 * scale;
        ctx.fillStyle = "#17120f";
        roundedPath(ctx, pip, pipRadius);
        ctx.fill();
        ctx.restore();

        if (video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
          const crop = coverSourceRect(video.videoWidth, video.videoHeight, pip.width, pip.height);
          ctx.save();
          roundedPath(ctx, pip, pipRadius);
          ctx.clip();
          ctx.translate(pip.x + pip.width, pip.y);
          ctx.scale(-1, 1);
          ctx.drawImage(
            video,
            crop.x,
            crop.y,
            crop.width,
            crop.height,
            0,
            0,
            pip.width,
            pip.height,
          );
          ctx.restore();
        }
        ctx.strokeStyle = "rgba(255,255,255,0.32)";
        ctx.lineWidth = Math.max(1, scale);
        roundedPath(ctx, pip, pipRadius);
        ctx.stroke();
      }

      // Draw the same end-call dock that is visible over the live call.
      const controls = callControlsRef.current;
      const endButton = endButtonRef.current;
      if (state.phase === "roasting" && controls && endButton) {
        const controlsRect = mapElementToRecording(
          frameRect,
          rectOf(controls.getBoundingClientRect()),
          recordingFrame,
        );
        const buttonRect = mapElementToRecording(
          frameRect,
          rectOf(endButton.getBoundingClientRect()),
          recordingFrame,
        );
        ctx.fillStyle = "rgba(14,9,7,0.64)";
        roundedPath(ctx, controlsRect, 28 * scale);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.14)";
        ctx.lineWidth = Math.max(1, scale);
        ctx.stroke();

        const red = ctx.createLinearGradient(buttonRect.x, buttonRect.y, buttonRect.x, buttonRect.y + buttonRect.height);
        red.addColorStop(0, "#fb4d42");
        red.addColorStop(1, "#cc211b");
        ctx.fillStyle = red;
        roundedPath(ctx, buttonRect, buttonRect.width / 2);
        ctx.fill();

        const iconSize = 28 * scale;
        ctx.save();
        ctx.translate(
          buttonRect.x + (buttonRect.width - iconSize) / 2,
          buttonRect.y + (buttonRect.height - iconSize) / 2,
        );
        ctx.scale(iconSize / 24, iconSize / 24);
        ctx.fillStyle = "#fff";
        ctx.fill(hangupPath);
        ctx.restore();

        ctx.fillStyle = "rgba(255,255,255,0.68)";
        ctx.font = `700 ${Math.max(8, 10 * scale)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(
          "END",
          controlsRect.x + controlsRect.width / 2,
          controlsRect.y + controlsRect.height - 6 * scale,
        );
      }

      ctx.restore();
      if (frameRadius > 0) {
        ctx.strokeStyle = "rgba(255,255,255,0.14)";
        ctx.lineWidth = Math.max(1, scale);
        roundedPath(ctx, recordingFrame, frameRadius);
        ctx.stroke();
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      observer?.disconnect();
      cancelAnimationFrame(rafRef.current);
      stream.getTracks().forEach((track) => track.stop());
      configureRef.current = () => null;
      handle.current.canvas = null;
      handle.current.stream = null;
    };
  }, [callControlsRef, callFrameRef, endButtonRef, puppetCanvasRef, selfViewRef, webcamVideoRef]);

  return handle;
}
