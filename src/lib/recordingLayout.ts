export interface RecordingRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RecordingSize {
  width: number;
  height: number;
}

function even(value: number): number {
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

/** Preserve the live call-frame aspect ratio while keeping H.264 dimensions even. */
export function recordingSizeForFrame(
  frameWidth: number,
  frameHeight: number,
  maxEdge = 1280,
): RecordingSize {
  if (frameWidth <= 0 || frameHeight <= 0) {
    return { width: 720, height: 720 };
  }

  if (frameWidth >= frameHeight) {
    return {
      width: even(maxEdge),
      height: even((frameHeight / frameWidth) * maxEdge),
    };
  }

  return {
    width: even((frameWidth / frameHeight) * maxEdge),
    height: even(maxEdge),
  };
}

/** Fit one aspect ratio inside another without stretching it. */
export function containRecordingRect(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): RecordingRect {
  if (sourceWidth <= 0 || sourceHeight <= 0 || targetWidth <= 0 || targetHeight <= 0) {
    return { x: 0, y: 0, width: targetWidth, height: targetHeight };
  }
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    x: (targetWidth - width) / 2,
    y: (targetHeight - height) / 2,
    width,
    height,
  };
}

/** Map a live DOM overlay (PIP/control) into the contained recording frame. */
export function mapElementToRecording(
  frame: RecordingRect,
  element: RecordingRect,
  recordingFrame: RecordingRect,
): RecordingRect {
  if (frame.width <= 0 || frame.height <= 0) {
    return { ...recordingFrame };
  }
  const scaleX = recordingFrame.width / frame.width;
  const scaleY = recordingFrame.height / frame.height;
  return {
    x: recordingFrame.x + (element.x - frame.x) * scaleX,
    y: recordingFrame.y + (element.y - frame.y) * scaleY,
    width: element.width * scaleX,
    height: element.height * scaleY,
  };
}

/** Source crop matching CSS object-fit: cover for an arbitrary target box. */
export function coverSourceRect(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): RecordingRect {
  if (sourceWidth <= 0 || sourceHeight <= 0 || targetWidth <= 0 || targetHeight <= 0) {
    return { x: 0, y: 0, width: sourceWidth, height: sourceHeight };
  }
  const sourceAspect = sourceWidth / sourceHeight;
  const targetAspect = targetWidth / targetHeight;
  if (sourceAspect > targetAspect) {
    const width = sourceHeight * targetAspect;
    return { x: (sourceWidth - width) / 2, y: 0, width, height: sourceHeight };
  }
  const height = sourceWidth / targetAspect;
  return { x: 0, y: (sourceHeight - height) / 2, width: sourceWidth, height };
}
