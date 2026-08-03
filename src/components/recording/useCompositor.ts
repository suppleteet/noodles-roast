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

function hasVisibleColor(color: string): boolean {
  return color !== "transparent" && !/rgba\([^)]*,\s*0(?:\.0+)?\)/.test(color);
}

function splitCssArguments(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts;
}

function linearGradientFromCss(
  ctx: CanvasRenderingContext2D,
  backgroundImage: string,
  rect: RecordingRect,
): CanvasGradient | null {
  const match = backgroundImage.match(/^linear-gradient\((.*)\)$/);
  if (!match) return null;
  const args = splitCssArguments(match[1]);
  if (args.length < 2) return null;

  let angle = 180;
  const angleMatch = args[0].match(/^(-?[\d.]+)deg$/);
  if (angleMatch) {
    angle = Number.parseFloat(angleMatch[1]);
    args.shift();
  }
  if (args.length < 2) return null;

  // CSS angles point upward at 0deg and rightward at 90deg.
  const radians = (angle * Math.PI) / 180;
  const dx = Math.sin(radians);
  const dy = -Math.cos(radians);
  const halfLength = (Math.abs(rect.width * dx) + Math.abs(rect.height * dy)) / 2;
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  const gradient = ctx.createLinearGradient(
    centerX - dx * halfLength,
    centerY - dy * halfLength,
    centerX + dx * halfLength,
    centerY + dy * halfLength,
  );

  args.forEach((stop, index) => {
    const stopMatch = stop.match(/^(rgba?\([^)]*\)|#[\da-fA-F]{3,8}|[a-zA-Z]+)(?:\s+([\d.]+)%?)?$/);
    if (!stopMatch) return;
    const fallbackOffset = args.length === 1 ? 0 : index / (args.length - 1);
    const offset = stopMatch[2]
      ? Math.min(1, Math.max(0, Number.parseFloat(stopMatch[2]) / 100))
      : fallbackOffset;
    gradient.addColorStop(offset, stopMatch[1]);
  });
  return gradient;
}

function drawDomBox(
  ctx: CanvasRenderingContext2D,
  element: HTMLElement,
  frameRect: RecordingRect,
  recordingFrame: RecordingRect,
): RecordingRect {
  const rect = mapElementToRecording(
    frameRect,
    rectOf(element.getBoundingClientRect()),
    recordingFrame,
  );
  const scale = recordingFrame.width / Math.max(1, frameRect.width);
  const style = getComputedStyle(element);
  const radius = (Number.parseFloat(style.borderTopLeftRadius) || 0) * scale;

  const background = linearGradientFromCss(ctx, style.backgroundImage, rect);
  if (background || hasVisibleColor(style.backgroundColor)) {
    ctx.fillStyle = background ?? style.backgroundColor;
    roundedPath(ctx, rect, radius);
    ctx.fill();
  }

  const borderWidth = (Number.parseFloat(style.borderTopWidth) || 0) * scale;
  if (borderWidth > 0 && hasVisibleColor(style.borderTopColor)) {
    ctx.strokeStyle = style.borderTopColor;
    ctx.lineWidth = borderWidth;
    roundedPath(ctx, rect, radius);
    ctx.stroke();
  }
  return rect;
}

function transformedText(text: string, transform: string): string {
  if (transform === "uppercase") return text.toUpperCase();
  if (transform === "lowercase") return text.toLowerCase();
  if (transform === "capitalize") {
    return text.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
  }
  return text;
}

/**
 * Paint text from the live DOM using its resolved geometry and typography.
 * The DOM remains the authoring model; the visible/captured canvas consumes it.
 */
function drawDomText(
  ctx: CanvasRenderingContext2D,
  element: HTMLElement,
  frameRect: RecordingRect,
  recordingFrame: RecordingRect,
): void {
  const text = transformedText(
    element.textContent?.trim() ?? "",
    getComputedStyle(element).textTransform,
  );
  if (!text) return;

  const rect = mapElementToRecording(
    frameRect,
    rectOf(element.getBoundingClientRect()),
    recordingFrame,
  );
  const scale = recordingFrame.width / Math.max(1, frameRect.width);
  const style = getComputedStyle(element);
  const fontSize = (Number.parseFloat(style.fontSize) || 12) * scale;
  const maxWidth = Math.max(0, rect.width);
  ctx.fillStyle = style.color;
  ctx.font = `${style.fontStyle} ${style.fontWeight} ${fontSize}px ${style.fontFamily}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = style.textAlign === "right" || style.textAlign === "center"
    ? style.textAlign
    : "left";
  const x = ctx.textAlign === "right"
    ? rect.x + rect.width
    : ctx.textAlign === "center"
      ? rect.x + rect.width / 2
      : rect.x;
  ctx.fillText(truncateText(ctx, text, maxWidth), x, rect.y + rect.height / 2, maxWidth);
}

/** Draw the exact live SVG paths by mapping their browser CTM into recording pixels. */
function drawDomSvg(
  ctx: CanvasRenderingContext2D,
  svg: SVGSVGElement,
  frameRect: RecordingRect,
  recordingFrame: RecordingRect,
): void {
  const scaleX = recordingFrame.width / Math.max(1, frameRect.width);
  const scaleY = recordingFrame.height / Math.max(1, frameRect.height);
  for (const pathElement of svg.querySelectorAll("path")) {
    const pathData = pathElement.getAttribute("d");
    const matrix = pathElement.getScreenCTM();
    if (!pathData || !matrix) continue;
    const style = getComputedStyle(pathElement);
    const path = new Path2D(pathData);

    ctx.save();
    ctx.setTransform(
      matrix.a * scaleX,
      matrix.b * scaleY,
      matrix.c * scaleX,
      matrix.d * scaleY,
      recordingFrame.x + (matrix.e - frameRect.x) * scaleX,
      recordingFrame.y + (matrix.f - frameRect.y) * scaleY,
    );
    ctx.lineWidth = Number.parseFloat(style.strokeWidth) || 1;
    ctx.lineCap = style.strokeLinecap as CanvasLineCap;
    ctx.lineJoin = style.strokeLinejoin as CanvasLineJoin;
    if (hasVisibleColor(style.fill) && style.fill !== "none") {
      ctx.fillStyle = style.fill;
      ctx.fill(path);
    }
    if (hasVisibleColor(style.stroke) && style.stroke !== "none") {
      ctx.strokeStyle = style.stroke;
      ctx.stroke(path);
    }
    ctx.restore();
  }
}

/**
 * Draws the same responsive call composition the user sees into a captureStream:
 * puppet stage, mirrored self-view, live HUD/vignette, and the end-call control.
 * Encoder dimensions are frozen when recording starts; later rotation is contained
 * inside that stable frame so Android MP4 encoders never see a mid-stream resize.
 */
export function useCompositor(
  puppetCanvasRef: React.RefObject<HTMLCanvasElement | null>,
  surfaceCanvasRef: React.RefObject<HTMLCanvasElement | null>,
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
    // This is intentionally the canvas mounted over the live call, not a second
    // offscreen reconstruction. MediaRecorder therefore captures the exact same
    // pixels the caller sees.
    const canvas = surfaceCanvasRef.current;
    if (!canvas) return;
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

      // Recordable DOM text is authored once in the HUD and painted from its
      // resolved layout/style. This removes the old recording-only LIVE badge.
      frameElement?.querySelectorAll<HTMLElement>("[data-recording-text]").forEach((element) => {
        drawDomText(ctx, element, frameRect, recordingFrame);
      });

      // Mirrored self-view, mapped from its actual responsive DOM rectangle.
      const video = webcamVideoRef.current;
      const selfView = selfViewRef.current;
      if (selfView) {
        const pip = mapElementToRecording(frameRect, rectOf(selfView.getBoundingClientRect()), recordingFrame);
        const pipRadiusCss = Number.parseFloat(getComputedStyle(selfView).borderTopLeftRadius) || 0;
        const pipRadius = pipRadiusCss * scale;
        const selfViewStyle = getComputedStyle(selfView);
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.42)";
        ctx.shadowBlur = 24 * scale;
        ctx.shadowOffsetY = 10 * scale;
        ctx.fillStyle = selfViewStyle.backgroundColor;
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
        const pipBorderWidth = (Number.parseFloat(selfViewStyle.borderTopWidth) || 0) * scale;
        if (pipBorderWidth > 0 && hasVisibleColor(selfViewStyle.borderTopColor)) {
          ctx.strokeStyle = selfViewStyle.borderTopColor;
          ctx.lineWidth = pipBorderWidth;
          roundedPath(ctx, pip, pipRadius);
          ctx.stroke();
        }
      }

      // The DOM owns layout, colors, typography, and the SVG path. The canvas
      // consumes those resolved values, so call-control edits automatically
      // become both the visible surface and the recording.
      const controls = callControlsRef.current;
      const endButton = endButtonRef.current;
      if (state.phase === "roasting" && controls && endButton) {
        drawDomBox(ctx, controls, frameRect, recordingFrame);
        drawDomBox(ctx, endButton, frameRect, recordingFrame);
        const icon = endButton.querySelector<SVGSVGElement>("svg");
        if (icon) drawDomSvg(ctx, icon, frameRect, recordingFrame);
        const label = controls.querySelector<HTMLElement>(".call-control-label");
        if (label) drawDomText(ctx, label, frameRect, recordingFrame);
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
  }, [callControlsRef, callFrameRef, endButtonRef, puppetCanvasRef, selfViewRef, surfaceCanvasRef, webcamVideoRef]);

  return handle;
}
