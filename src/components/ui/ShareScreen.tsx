"use client";
import { useMemo, useRef, useState, useEffect } from "react";
import { upload } from "@vercel/blob/client";
import { useSessionStore } from "@/store/useSessionStore";
import FeedbackBox from "@/components/ui/FeedbackBox";
import { useDevUnlock } from "@/lib/devUnlock";

interface SaveVideoResponse {
  folder?: string;
  filename?: string;
  mimeType?: string;
  sizeBytes?: number;
  conversionError?: string;
  error?: string;
}

type UploadState =
  | { status: "idle" }
  | { status: "uploading"; uploadedBytes: number; totalBytes: number }
  | { status: "finalizing" }
  | { status: "complete"; webViewLink: string }
  | { status: "error"; message: string };

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
  const IS_DEV = useDevUnlock();
  const [playing, setPlaying] = useState(false);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoAspectRatio, setVideoAspectRatio] = useState("1 / 1");
  const [fancyName, setFancyName] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const [savedFolder, setSavedFolder] = useState<string | null>(null);
  const [savedFilename, setSavedFilename] = useState<string | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [uploadState, setUploadState] = useState<UploadState>({ status: "idle" });
  const uploadAbortRef = useRef<AbortController | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const savedBlobRef = useRef<Blob | null>(null);

  // The recording the client holds IS the source of truth — Download and
  // Send-to-Tyler both work straight from it, so they don't depend on the
  // server having stashed a copy (which doesn't survive Vercel serverless).
  const shareBlob = videoBlob;
  const recordingMissing = !recordedBlob || recordedBlob.size === 0;
  const shareFilename = useMemo(
    () => (fancyName ? `${fancyName}.mp4` : "roastie.mp4"),
    [fancyName],
  );
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
    setFancyName(null);
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
          // Pass the user's selected roast model so name-video honors the
          // model fallback. Without this, the route falls back to ROAST_MODEL
          // (for example Gemini Flash) which may 503 when that tier is overloaded, and the
          // share UI ends up with the timestamp fallback name.
          //
          // experienceType drives the filename prefix — Roastie_ vs Toastie_
          // — so a toast session's downloaded MP4 reads as Toastie_… on disk.
          const { roastModel, experienceType } = useSessionStore.getState();
          const nameResp = await fetch("/api/name-video", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ transcript, model: roastModel, experienceType }),
          });
          if (nameResp.ok) {
            const data = (await nameResp.json().catch(() => ({}))) as { filename?: string };
            suggestedName = typeof data.filename === "string" ? data.filename : null;
          }
        } catch {
          // Best-effort — Download/Share fall back to "roastie.mp4".
        }
        setFancyName(suggestedName);

        // Best-effort local-disk save. This powers the dev "open videos folder"
        // button on localhost (one persistent process). On Vercel it may fail —
        // serverless /tmp is per-invocation and the function body cap is ~4.5MB
        // — but the share UI no longer depends on it: Download reads the
        // in-memory blob, and Send-to-Tyler uploads it to Vercel Blob directly.
        try {
          const saveUrl = suggestedName
            ? `/api/save-video?name=${encodeURIComponent(suggestedName)}`
            : "/api/save-video";
          const saveResp = await fetch(saveUrl, {
            method: "POST",
            headers: { "Content-Type": "video/mp4" },
            body: recordedBlob,
          });
          if (saveResp.ok) {
            const data = (await saveResp.json().catch(() => ({}))) as SaveVideoResponse;
            setSavedFolder(data.folder ?? null);
            setSavedFilename(data.filename ?? null);
          }
        } catch {
          // Ignore — local save is non-essential.
        }
      } finally {
        setConverting(false);
      }
    })();
  }, [recordedBlob]);

  useEffect(() => {
    if (!videoBlob) return;
    setVideoAspectRatio("1 / 1");
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
    // Download straight from the in-memory recording. Android Chrome (Tyler's
    // mobile target) honors <a download="..."> with a blob: URL, so the file
    // saves with the clever name. The old server-served path needed the file
    // to survive on the server's disk — which it doesn't on Vercel serverless.
    if (!shareBlob) return;
    const url = URL.createObjectURL(shareBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = shareFilename;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function handleSendToTyler() {
    if (!shareBlob) return;
    // Abort any in-flight upload before starting a new one. In practice the
    // button is disabled while busy and the modal hides its close button mid-
    // upload, so this abort path only fires as restart semantics (a fresh Send
    // after a prior error), never as a user cancel.
    if (uploadAbortRef.current) uploadAbortRef.current.abort();
    const abort = new AbortController();
    uploadAbortRef.current = abort;
    setUploadState({ status: "uploading", uploadedBytes: 0, totalBytes: shareBlob.size });

    try {
      // Step 1: browser → Vercel Blob. Client upload streams directly to Blob
      // storage, dodging the ~4.5MB serverless request-body cap that broke the
      // old "POST the video to the server" approach on Vercel.
      const blob = await upload(shareFilename, shareBlob, {
        access: "public",
        handleUploadUrl: "/api/video-blob-upload",
        contentType: "video/mp4",
        multipart: shareBlob.size > 8 * 1024 * 1024,
        abortSignal: abort.signal,
        onUploadProgress: ({ loaded, total }) =>
          setUploadState({ status: "uploading", uploadedBytes: loaded, totalBytes: total }),
      });

      // Step 2: server copies the durable Blob URL into Drive (server→server,
      // fast) and deletes the temporary Blob copy.
      setUploadState({ status: "finalizing" });
      const resp = await fetch("/api/upload-to-drive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blobUrl: blob.url, filename: shareFilename }),
        signal: abort.signal,
      });
      const data = (await resp.json().catch(() => ({}))) as {
        webViewLink?: string;
        error?: string;
      };
      if (!resp.ok || !data.webViewLink) {
        throw new Error(data.error ?? `Drive upload failed (${resp.status})`);
      }
      setUploadState({ status: "complete", webViewLink: data.webViewLink });
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      console.warn("[share] send-to-tyler failed:", e);
      setUploadState({
        status: "error",
        message: e instanceof Error ? e.message : "Upload failed",
      });
    }
  }

  function closeUploadModal() {
    uploadAbortRef.current?.abort();
    uploadAbortRef.current = null;
    setUploadState({ status: "idle" });
  }

  function handleOpenFolder() {
    fetch("/api/open-videos-folder", { method: "POST" }).catch((e) =>
      console.warn("[open-folder] failed:", e),
    );
  }

  const buttonsDisabled = converting || !shareBlob || shareBlob.size === 0;

  return (
    <div data-testid="share-screen" className="flex h-full min-h-0 flex-col items-center justify-start overflow-y-auto bg-[radial-gradient(circle_at_50%_12%,rgba(249,115,22,0.16),transparent_32%),#030201] px-5 py-8 text-center text-white">
      <div data-testid="share-preview" className="relative mb-6 w-full max-w-sm">
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

        <div
          data-testid="share-video-shell"
          className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-gray-950 shadow-2xl shadow-orange-950/30"
          style={{ aspectRatio: videoAspectRatio }}
        >
          <video
            ref={videoRef}
            className="h-full w-full object-contain"
            onLoadedMetadata={(event) => {
              const { videoWidth, videoHeight } = event.currentTarget;
              if (videoWidth > 0 && videoHeight > 0) {
                setVideoAspectRatio(`${videoWidth} / ${videoHeight}`);
              }
            }}
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

      {converting && (
        <div className="mb-4 w-full max-w-sm">
          <p className="mb-2 text-sm font-medium text-white/80">
            Processing video…
          </p>
          <div className="relative h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div className="absolute inset-y-0 left-0 w-1/3 animate-indeterminate-slide rounded-full bg-orange-500" />
          </div>
        </div>
      )}

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
          disabled={
            buttonsDisabled ||
            uploadState.status === "uploading" ||
            uploadState.status === "finalizing"
          }
          title="Upload this video to Tyler's Drive folder"
          className="rounded-xl bg-purple-600 px-6 py-3 font-black transition-all hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-purple-600"
        >
          Send to Tyler
        </button>
      </div>

      {!converting && recordingMissing ? (
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

      {uploadState.status !== "idle" && (
        <UploadProgressModal state={uploadState} onClose={closeUploadModal} />
      )}
    </div>
  );
}

function UploadProgressModal({
  state,
  onClose,
}: {
  state: Exclude<UploadState, { status: "idle" }>;
  onClose: () => void;
}) {
  const percent = (() => {
    if (state.status === "complete") return 100;
    if (state.status === "finalizing") return 100;
    if (state.status === "error") return 0;
    if (state.totalBytes === 0) return 0;
    return Math.min(100, Math.round((state.uploadedBytes / state.totalBytes) * 100));
  })();
  const sizeLabel = state.status === "uploading"
    ? `${formatBytes(state.uploadedBytes)} / ${formatBytes(state.totalBytes)}`
    : null;
  // The browser→Blob upload and the server→Drive copy both block closing.
  const busy = state.status === "uploading" || state.status === "finalizing";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-gray-950 p-6 text-left shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">
            {state.status === "uploading" && "Sending to Tyler…"}
            {state.status === "finalizing" && "Saving to Drive…"}
            {state.status === "complete" && "Upload complete"}
            {state.status === "error" && "Upload failed"}
          </h2>
          {!busy && (
            <button
              onClick={onClose}
              className="text-xl leading-none text-white/40 hover:text-white"
              aria-label="Close"
            >
              x
            </button>
          )}
        </div>

        <div className="mb-3 h-3 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className={`h-full transition-all duration-200 ${
              state.status === "error" ? "bg-red-500" : "bg-purple-500"
            }`}
            style={{ width: `${percent}%` }}
          />
        </div>

        <div className="mb-5 flex items-baseline justify-between text-xs text-white/60">
          <span>
            {state.status === "uploading" && sizeLabel}
            {state.status === "finalizing" && "Copying into Tyler's Drive folder…"}
            {state.status === "complete" && "Saved to Tyler's Drive folder."}
            {state.status === "error" && state.message}
          </span>
          <span className="font-mono text-white/40">{percent}%</span>
        </div>

        {state.status === "complete" && (
          <button
            onClick={onClose}
            className="w-full rounded-xl bg-orange-600 px-6 py-3 font-black transition-all hover:bg-orange-500"
          >
            Close
          </button>
        )}
        {state.status === "error" && (
          <button
            onClick={onClose}
            className="w-full rounded-xl bg-white/10 px-6 py-3 font-black transition-all hover:bg-white/20"
          >
            Close
          </button>
        )}
        {busy && (
          <p className="text-center text-xs text-white/40">
            Don&apos;t close this window — hang tight.
          </p>
        )}
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
