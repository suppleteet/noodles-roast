"use client";
import { useRef, useState, useEffect } from "react";
import { useSessionStore } from "@/store/useSessionStore";

export default function ShareScreen() {
  const recordedBlob = useSessionStore((s) => s.recordedBlob);
  const reset = useSessionStore((s) => s.reset);
  const [playing, setPlaying] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Create and revoke the object URL to avoid blob URL memory leaks
  useEffect(() => {
    if (!recordedBlob) return;
    const url = URL.createObjectURL(recordedBlob);
    setVideoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [recordedBlob]);

  function handlePlayback() {
    if (!videoRef.current || !videoUrl) return;
    videoRef.current.src = videoUrl;
    videoRef.current.play();
    setPlaying(true);
  }

  async function handleShare() {
    if (!recordedBlob) return;
    const file = new File([recordedBlob], "roast-me.webm", { type: "video/webm" });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: "I got roasted by an AI puppet 🔥" });
    }
  }

  function handleDownload() {
    if (!videoUrl) return;
    const a = document.createElement("a");
    a.href = videoUrl;
    a.download = "roast-me.webm";
    a.click();
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-black text-white px-6 text-center">
      <h2 className="text-4xl font-black mb-2">You got roasted. 🔥</h2>
      <p className="text-gray-400 mb-8">Share your suffering with the world.</p>

      <div className="relative w-full max-w-sm aspect-square bg-gray-900 rounded-2xl overflow-hidden mb-6">
        <video
          ref={videoRef}
          className="w-full h-full object-cover"
          onEnded={() => setPlaying(false)}
          playsInline
        />
        {!playing && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <button
              onClick={handlePlayback}
              className="w-16 h-16 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-3xl transition-all"
            >
              ▶
            </button>
          </div>
        )}
      </div>

      <div className="flex gap-3 mb-8 flex-wrap justify-center">
        {typeof navigator !== "undefined" && "share" in navigator && (
          <button
            onClick={handleShare}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-500 rounded-xl font-bold transition-all"
          >
            Share Video
          </button>
        )}
        <button
          onClick={handleDownload}
          className="px-6 py-3 bg-gray-700 hover:bg-gray-600 rounded-xl font-bold transition-all"
        >
          Download
        </button>
      </div>

      <button onClick={reset} className="text-gray-500 hover:text-gray-300 text-sm">
        ← Roast me again
      </button>
    </div>
  );
}
