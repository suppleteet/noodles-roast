"use client";
import { useRef, useState, useEffect } from "react";
import { useSessionStore } from "@/store/useSessionStore";

export default function ShareScreen() {
  const recordedBlob = useSessionStore((s) => s.recordedBlob);
  const reset = useSessionStore((s) => s.reset);
  const [playing, setPlaying] = useState(false);
  // The playback blob — MP4 from server if conversion succeeded, raw WebM otherwise.
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [savedFolder, setSavedFolder] = useState<string | null>(null);
  const [savedFilename, setSavedFilename] = useState<string | null>(null);
  const [converting, setConverting] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  // Prevent double-save (React StrictMode fires effects twice in dev)
  const savedBlobRef = useRef<Blob | null>(null);

  // Upload WebM → server converts to MP4 → fetch MP4 back for playback + sharing.
  useEffect(() => {
    if (!recordedBlob || savedBlobRef.current === recordedBlob) return;
    savedBlobRef.current = recordedBlob;
    setConverting(true);

    (async () => {
      let mp4Blob: Blob | null = null;
      let folder: string | null = null;
      let filename: string | null = null;

      try {
        const saveResp = await fetch("/api/save-video", {
          method: "POST",
          headers: { "Content-Type": "video/webm" },
          body: recordedBlob,
        });
        const data: { folder?: string; filename?: string; conversionError?: string } =
          await saveResp.json();

        folder = data.folder ?? null;
        filename = data.filename ?? null;
        if (folder) setSavedFolder(folder);
        if (filename) setSavedFilename(filename);

        // Fetch the converted MP4 back so the client has it for sharing + playback.
        if (filename?.endsWith(".mp4")) {
          const serveResp = await fetch(
            `/api/serve-video?filename=${encodeURIComponent(filename)}`,
          );
          if (serveResp.ok) {
            mp4Blob = await serveResp.blob();
          }
        }
      } catch (e) {
        console.warn("[share] save/fetch failed:", e);
      }

      // Fall back to the raw WebM if conversion failed.
      setVideoBlob(mp4Blob ?? recordedBlob);
      setConverting(false);
    })();
  }, [recordedBlob]);

  // Create and revoke the object URL whenever the playback blob changes.
  useEffect(() => {
    if (!videoBlob) return;
    const url = URL.createObjectURL(videoBlob);
    setVideoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [videoBlob]);

  // Set src as soon as URL is ready — browser decodes the first frame as the poster.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;
    video.src = videoUrl;
    video.load();
  }, [videoUrl]);

  function handlePlayback() {
    const video = videoRef.current;
    if (!video) return;
    // src is already set by the effect above; just play.
    video.play();
    setPlaying(true);
  }

  async function handleShare() {
    if (!videoBlob) return;
    const isMp4 = videoBlob.type === "video/mp4";
    const name = isMp4 ? "roastie.mp4" : "roastie.webm";
    const file = new File([videoBlob], name, { type: videoBlob.type });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: "Roastie" });
    }
  }

  function handleDownload() {
    if (!videoUrl || !videoBlob) return;
    const isMp4 = videoBlob.type === "video/mp4";
    const ext = isMp4 ? ".mp4" : ".webm";
    const name = savedFilename
      ? savedFilename.replace(/\.\w+$/, ext)
      : `roastie${ext}`;
    const a = document.createElement("a");
    a.href = videoUrl;
    a.download = name;
    a.click();
  }

  function handleOpenFolder() {
    fetch("/api/open-videos-folder", { method: "POST" }).catch((e) =>
      console.warn("[open-folder] failed:", e),
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-black text-white px-6 text-center">

      {/* Video frame with folder button above top-right */}
      <div className="relative w-full max-w-sm mb-6">
        <button
          onClick={handleOpenFolder}
          title={savedFolder ?? "Open videos folder"}
          className="absolute -top-8 right-0 p-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-all text-white/60 hover:text-white/90"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="w-5 h-5"
          >
            <path d="M2 6a2 2 0 012-2h4l2 2h6a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
          </svg>
        </button>

        <div className="relative aspect-square bg-gray-900 rounded-2xl overflow-hidden">
          {converting ? (
            /* Spinner while server converts WebM → MP4 */
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-gray-400">
              <svg
                className="w-10 h-10 animate-spin text-orange-500"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8v8H4z"
                />
              </svg>
              <span className="text-sm">Processing video…</span>
            </div>
          ) : (
            <>
              {/* src set by effect above — browser shows first frame before play is clicked */}
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                onEnded={() => setPlaying(false)}
                playsInline
                preload="auto"
              />
              {!playing && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <button
                    onClick={handlePlayback}
                    className="w-16 h-16 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-3xl transition-all"
                  >
                    ▶
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex gap-3 mb-8 flex-wrap justify-center">
        {!converting && typeof navigator !== "undefined" && "share" in navigator && (
          <button
            onClick={handleShare}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-500 rounded-xl font-bold transition-all"
          >
            Share
          </button>
        )}
        {!converting && (
          <button
            onClick={handleDownload}
            className="px-6 py-3 bg-gray-700 hover:bg-gray-600 rounded-xl font-bold transition-all"
          >
            Download
          </button>
        )}
      </div>

      <button onClick={reset} className="text-gray-500 hover:text-gray-300 text-sm">
        ← Roast again
      </button>
    </div>
  );
}
