export type VideoExtension = "mp4";

export interface RecorderFormat {
  mimeType: string;
  extension: VideoExtension;
  label: string;
}

// MP4-only: Vercel Hobby tier (50MB function limit) can't bundle ffmpeg-static
// (~80MB) for server-side WebM→MP4 conversion, so the recorder has to produce
// MP4 directly. Browsers without MP4 MediaRecorder support are blocked from
// recording — we surface a clear message instead of producing a WebM we can't
// convert. Supported: Safari (iOS+macOS), Chrome (desktop + Android 12+), Edge.
export const RECORDER_FORMAT_CANDIDATES: readonly RecorderFormat[] = [
  {
    mimeType: "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    extension: "mp4",
    label: "MP4/H.264",
  },
  {
    mimeType: "video/mp4;codecs=h264,aac",
    extension: "mp4",
    label: "MP4/H.264",
  },
  {
    mimeType: "video/mp4",
    extension: "mp4",
    label: "MP4",
  },
];

export function extensionForMimeType(_mimeType: string | null | undefined): VideoExtension {
  return "mp4";
}

export function contentTypeForVideoFilename(_filename: string): string {
  return "video/mp4";
}

export function isSafeVideoFilename(filename: string | null | undefined): filename is string {
  if (!filename) return false;
  if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) return false;
  return /\.mp4$/i.test(filename);
}

/**
 * Returns the first supported MP4 candidate, or `null` if the browser's
 * MediaRecorder can't produce MP4 at all. Callers must handle the null case
 * — show a "browser unsupported" message rather than fall back to WebM.
 */
export function chooseRecorderFormat(
  isTypeSupported?: (mimeType: string) => boolean,
): RecorderFormat | null {
  const supports =
    isTypeSupported ??
    ((mimeType: string) =>
      typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mimeType));

  return (
    RECORDER_FORMAT_CANDIDATES.find((format) => {
      try {
        return supports(format.mimeType);
      } catch {
        return false;
      }
    }) ?? null
  );
}

/**
 * Target ~10 MB per ~3-minute session (≈450 kbps video + ~64 kbps audio).
 * MediaRecorder uses constant bitrate, so total bytes ≈ rate × duration.
 * The stylized puppet + small webcam PIP encode efficiently at low rates;
 * shaving below this trades visible quality for marginal size gains.
 */
export function recommendedVideoBitsPerSecond(
  width: number,
  height: number,
  fps = 30,
): number {
  const pixelsPerSecond = Math.max(1, width) * Math.max(1, height) * Math.max(1, fps);
  // 0.025 bits/pixel/frame ≈ 388 kbps at 720x720@30. Floor at 350 kbps keeps
  // smaller compositor sizes legible; ceiling at 700 kbps caps very large
  // compositors so a ~5min session can still fit ~10MB.
  return Math.round(Math.min(700_000, Math.max(350_000, pixelsPerSecond * 0.025)));
}

/**
 * MP4/AAC audio bitrate. The puppet's TTS-rendered voice has musical
 * texture (laughs, prosody swings) that turns to garbage below ~96 kbps,
 * so 192 kbps stays here for noticeable headroom. Per-session size impact
 * is ~3 MB over 3 min — fits well under the 10 MB envelope alongside the
 * ~400 kbps video stream.
 */
export const RECOMMENDED_AUDIO_BITS_PER_SECOND = 192_000;

/**
 * True when MediaRecorder can produce MP4 in this browser. Gate session
 * start on this — if false, surface a "browser unsupported" message rather
 * than silently producing a WebM the server can't accept.
 */
export function isMp4RecordingSupported(): boolean {
  return chooseRecorderFormat() !== null;
}
