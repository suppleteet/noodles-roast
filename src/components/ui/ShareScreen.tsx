"use client";
import { useMemo, useRef, useState, useEffect } from "react";
import { useSessionStore } from "@/store/useSessionStore";
import FeedbackBox from "@/components/ui/FeedbackBox";

const IS_DEV = process.env.NODE_ENV !== "production";

// Tyler's public Drive folder for roast collection. Must be shared as
// "Anyone with the link → Editor" so visitors can upload.
const TYLER_DRIVE_FOLDER_URL =
  "https://drive.google.com/drive/folders/1W5-3ciAzFXeLJ1GEF3jz6it3lvD52LUP";

interface SaveVideoResponse {
  folder?: string;
  filename?: string;
  mimeType?: string;
  sizeBytes?: number;
  conversionError?: string;
  error?: string;
}

function preferredFilename(filename: string | null, blob: Blob | null): string {
  if (filename) return filename;
  return blob?.type === "video/mp4" ? "roastie.mp4" : "roastie.webm";
}

/** Build the last-N lines of the conversation as role-prefixed text for /api/name-video. */
function buildTranscriptForNaming(
  history: { role: "user" | "puppet"; text: string }[],
  maxLines: number = 24,
): string[] {
  return history
    .slice(-maxLines)
    .map(({ role, text }) => ({ role, text: text.trim() }))
    .filter((entry) => entry.text.length > 0)
    .map((entry) => `${entry.role}: ${entry.text}`);
}

export default function ShareScreen() {
  const recordedBlob = useSessionStore((s) => s.recordedBlob);
  const reset = useSessionStore((s) => s.reset);
  const [playing, setPlaying] = useState(false);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [mp4Blob, setMp4Blob] = useState<Blob | null>(null);
  const [converting, setConverting] = useState(false);
  const [savedFolder, setSavedFolder] = useState<string | null>(null);
  const [savedFilename, setSavedFilename] = useState<string | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const savedBlobRef = useRef<Blob | null>(null);

  const shareBlob = mp4Blob ?? videoBlob;
  const recordingMissing = !recordedBlob || recordedBlob.size === 0;
  const shareFilename = preferredFilename(savedFilename, shareBlob);
  const hasNativeShare = typeof navigator !== "undefined" && "share" in navigator;

  const canNativeShare = useMemo(() => {
    if (!shareBlob || !hasNativeShare) return false;
    if (!navigator.canShare) return true;
    try {
      const file = new File([shareBlob], shareFilename, { type: shareBlob.type });
      return navigator.canShare({ files: [file] });
    } catch {
      return false;
    }
  }, [hasNativeShare, shareBlob, shareFilename]);

  useEffect(() => {
    if (!recordedBlob || recordedBlob.size === 0 || savedBlobRef.current === recordedBlob) return;
    savedBlobRef.current = recordedBlob;

    setVideoBlob(recordedBlob);
    setMp4Blob(null);
    setSavedFolder(null);
    setSavedFilename(null);
    setConverting(true);

    (async () => {
      try {
        // Ask the LLM for a clever name based on the conversation. Snapshot the transcript
        // via getState() so the effect can stay keyed on the recorded blob only — and so we
        // capture the FULL transcript that existed at session end, not whatever fragment
        // happened to be in scope when the effect closed over the store value.
        const transcript = buildTranscriptForNaming(useSessionStore.getState().transcriptHistory);
        let suggestedName: string | null = null;
        try {
          const nameResp = await fetch("/api/name-video", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ transcript }),
          });
          if (nameResp.ok) {
            const data = (await nameResp.json().catch(() => ({}))) as { filename?: string };
            suggestedName = typeof data.filename === "string" ? data.filename : null;
          }
        } catch {
          // Best-effort — save-video will fall back to its random adjective-noun name.
        }

        const saveUrl = suggestedName
          ? `/api/save-video?name=${encodeURIComponent(suggestedName)}`
          : "/api/save-video";
        const saveResp = await fetch(saveUrl, {
          method: "POST",
          headers: { "Content-Type": recordedBlob.type || "video/webm" },
          body: recordedBlob,
        });
        const data = (await saveResp.json().catch(() => ({}))) as SaveVideoResponse;
        if (!saveResp.ok) throw new Error(data.error ?? `save failed (${saveResp.status})`);

        setSavedFolder(data.folder ?? null);
        setSavedFilename(data.filename ?? null);

        if (data.filename) {
          const serveResp = await fetch(
            `/api/serve-video?filename=${encodeURIComponent(data.filename)}`,
          );
          if (serveResp.ok) {
            const savedBlob = await serveResp.blob();
            const normalizedBlob = savedBlob.type
              ? savedBlob
              : new Blob([savedBlob], { type: data.mimeType ?? recordedBlob.type });
            if (data.filename.endsWith(".mp4")) setMp4Blob(normalizedBlob);
            if (!videoRef.current || videoRef.current.paused) {
              setVideoBlob(normalizedBlob);
            }
          }
        }
      } catch (e) {
        console.warn("[share] save/fetch failed:", e);
      } finally {
        setConverting(false);
      }
    })();
  }, [recordedBlob]);

  useEffect(() => {
    if (!videoBlob) return;
    const url = URL.createObjectURL(videoBlob);
    setVideoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [videoBlob]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;
    video.src = videoUrl;
    video.load();
  }, [videoUrl]);

  async function handlePlayback() {
    const video = videoRef.current;
    if (!video) return;
    try {
      await video.play();
      setPlaying(true);
    } catch (e) {
      console.warn("[share] playback failed:", e);
    }
  }

  async function handleShare() {
    if (!shareBlob || !canNativeShare) return;
    const file = new File([shareBlob], shareFilename, { type: shareBlob.type });
    try {
      await navigator.share({ files: [file], title: "Roastie" });
    } catch (e) {
      if ((e as Error).name !== "AbortError") console.warn("[share] native share failed:", e);
    }
  }

  function handleDownload() {
    if (!shareBlob) return;
    const url = URL.createObjectURL(shareBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = shareFilename;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function handleSendToTyler() {
    if (!shareBlob) return;
    // Kick off the download first so the file is in the user's Downloads
    // folder by the time the Drive tab steals focus. Then open Tyler's
    // shared folder so they can upload the just-downloaded file.
    const url = URL.createObjectURL(shareBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = shareFilename;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    window.open(TYLER_DRIVE_FOLDER_URL, "_blank", "noopener,noreferrer");
  }

  function handleOpenFolder() {
    fetch("/api/open-videos-folder", { method: "POST" }).catch((e) =>
      console.warn("[open-folder] failed:", e),
    );
  }

  const buttonsDisabled = converting || !shareBlob || shareBlob.size === 0;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-black px-6 text-center text-white">
      <div className="relative mb-6 w-full max-w-sm">
        {IS_DEV && (
          <button
            onClick={handleOpenFolder}
            title={savedFolder ?? "Open videos folder"}
            className="absolute -top-8 right-0 rounded-lg bg-white/10 p-1.5 text-white/60 transition-all hover:bg-white/20 hover:text-white/90"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path d="M2 6a2 2 0 012-2h4l2 2h6a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
            </svg>
          </button>
        )}

        <div className="relative aspect-square overflow-hidden rounded-[2rem] border border-white/10 bg-gray-950 shadow-2xl shadow-orange-950/30">
          <video
            ref={videoRef}
            className="h-full w-full object-cover"
            onEnded={() => setPlaying(false)}
            onPause={() => setPlaying(false)}
            onPlay={() => setPlaying(true)}
            playsInline
            preload="metadata"
            controls={playing}
          />
          {!playing && videoUrl && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/45">
              <button
                onClick={handlePlayback}
                className="flex h-16 w-16 items-center justify-center rounded-full border border-white/20 bg-white/20 text-sm font-black uppercase tracking-widest transition-all hover:scale-105 hover:bg-white/30"
                aria-label="Play recording"
              >
                Play
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap justify-center gap-3">
        {hasNativeShare && (
          <button
            onClick={handleShare}
            disabled={buttonsDisabled || !canNativeShare}
            className="rounded-xl bg-orange-600 px-6 py-3 font-black transition-all hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-orange-600"
          >
            Share
          </button>
        )}
        <button
          onClick={handleDownload}
          disabled={buttonsDisabled}
          className="rounded-xl bg-white/10 px-6 py-3 font-black transition-all hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white/10"
        >
          Download
        </button>
        <button
          onClick={handleSendToTyler}
          disabled={buttonsDisabled}
          title="Downloads the video + opens Tyler's Drive folder so you can drop it in"
          className="rounded-xl bg-purple-600 px-6 py-3 font-black transition-all hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-purple-600"
        >
          Send to Tyler
        </button>
      </div>

      {converting ? (
        <p className="mb-4 text-xs text-white/40">Processing video...</p>
      ) : recordingMissing ? (
        <p className="mb-4 max-w-sm text-xs text-red-300/80">
          Recording did not produce a video. The session log will show recorder start/stop details.
        </p>
      ) : (
        <div className="mb-4" />
      )}

      <button
        onClick={reset}
        className="mb-4 rounded-xl bg-orange-600 px-10 py-3.5 text-lg font-black transition-all hover:bg-orange-500"
      >
        Roast Again
      </button>

      <button
        onClick={() => setShowFeedback(true)}
        className="text-sm text-white/40 transition-colors hover:text-white/70"
      >
        Leave Feedback
      </button>

      {showFeedback && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-6"
          onClick={(e) => { if (e.target === e.currentTarget) setShowFeedback(false); }}
        >
          <div className="w-full max-w-md rounded-2xl bg-gray-950 p-6 text-left">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">Leave Feedback</h2>
              <button
                onClick={() => setShowFeedback(false)}
                className="text-xl leading-none text-white/40 hover:text-white"
                aria-label="Close feedback"
              >
                x
              </button>
            </div>
            <FeedbackBox videoFilename={savedFilename} onSent={() => setShowFeedback(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
