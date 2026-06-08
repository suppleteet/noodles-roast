"use client";
import { useMemo, useRef, useState, useEffect } from "react";
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
  | { status: "complete"; webViewLink: string }
  | { status: "error"; message: string };

function preferredFilename(filename: string | null, _blob: Blob | null): string {
  return filename ?? "roastie.mp4";
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
  const IS_DEV = useDevUnlock();
  const [playing, setPlaying] = useState(false);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [mp4Blob, setMp4Blob] = useState<Blob | null>(null);
  const [converting, setConverting] = useState(false);
  const [savedFolder, setSavedFolder] = useState<string | null>(null);
  const [savedFilename, setSavedFilename] = useState<string | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [uploadState, setUploadState] = useState<UploadState>({ status: "idle" });
  const uploadAbortRef = useRef<AbortController | null>(null);
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
          // Pass the user's selected roast model so name-video honors the
          // model fallback. Without this, the route falls back to ROAST_MODEL
          // (gemini-3.5-flash) which 503s when 3.5 is overloaded, and the
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
          // Best-effort — save-video will fall back to its random adjective-noun name.
        }

        const saveUrl = suggestedName
          ? `/api/save-video?name=${encodeURIComponent(suggestedName)}`
          : "/api/save-video";
        const saveResp = await fetch(saveUrl, {
          method: "POST",
          headers: { "Content-Type": "video/mp4" },
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
    // Server-served URL with Content-Disposition: attachment is the only
    // reliable way to control the saved filename on mobile — Safari iOS and
    // Android Chrome both ignore <a download="..."> with a blob: URL and fall
    // back to "blob" or some default. Fall back to the blob path only if the
    // server save hasn't completed yet (rare — only if the user clicks while
    // the auto-save is still in flight).
    if (savedFilename) {
      const url = `/api/serve-video?filename=${encodeURIComponent(savedFilename)}&download=1`;
      const a = document.createElement("a");
      a.href = url;
      a.download = savedFilename;
      a.click();
      return;
    }
    if (!shareBlob) return;
    const url = URL.createObjectURL(shareBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = shareFilename;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function handleSendToTyler() {
    if (!savedFilename) return;
    if (uploadAbortRef.current) uploadAbortRef.current.abort();
    const abort = new AbortController();
    uploadAbortRef.current = abort;
    setUploadState({ status: "uploading", uploadedBytes: 0, totalBytes: 0 });

    try {
      const resp = await fetch("/api/upload-to-drive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: savedFilename }),
        signal: abort.signal,
      });
      if (!resp.ok || !resp.body) {
        const data = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `upload failed (${resp.status})`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let sseBuf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuf += decoder.decode(value, { stream: true });
        const lines = sseBuf.split("\n");
        sseBuf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          let event: { type: string; uploadedBytes?: number; totalBytes?: number; webViewLink?: string; message?: string };
          try {
            event = JSON.parse(line.slice(6));
          } catch {
            continue;
          }
          if (event.type === "progress") {
            setUploadState({
              status: "uploading",
              uploadedBytes: event.uploadedBytes ?? 0,
              totalBytes: event.totalBytes ?? 0,
            });
          } else if (event.type === "complete" && event.webViewLink) {
            setUploadState({ status: "complete", webViewLink: event.webViewLink });
          } else if (event.type === "error") {
            setUploadState({ status: "error", message: event.message ?? "Upload failed" });
          }
        }
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      console.warn("[share] upload failed:", e);
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
          disabled={buttonsDisabled || !savedFilename || uploadState.status === "uploading"}
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
    if (state.status === "error") return 0;
    if (state.totalBytes === 0) return 0;
    return Math.min(100, Math.round((state.uploadedBytes / state.totalBytes) * 100));
  })();
  const sizeLabel = state.status === "uploading"
    ? `${formatBytes(state.uploadedBytes)} / ${formatBytes(state.totalBytes)}`
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-gray-950 p-6 text-left shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">
            {state.status === "uploading" && "Sending to Tyler…"}
            {state.status === "complete" && "Upload complete"}
            {state.status === "error" && "Upload failed"}
          </h2>
          {state.status !== "uploading" && (
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
        {state.status === "uploading" && (
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
