"use client";
import { useSessionStore } from "@/store/useSessionStore";

export default function LandingScreen() {
  const setPhase = useSessionStore((s) => s.setPhase);
  const error = useSessionStore((s) => s.error);
  const setError = useSessionStore((s) => s.setError);

  function handleStart() {
    setError(null);
    setPhase("consent");
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-black text-white px-4 text-center">
      <div className="mb-8">
        <h1 className="text-6xl font-black mb-4 tracking-tight">
          ROAST ME
        </h1>
        <p className="text-xl text-gray-400 max-w-md">
          An AI puppet comedian analyzes you through your webcam and delivers a
          live roast. Brace yourself.
        </p>
      </div>

      {error && (
        <div className="mb-6 px-5 py-3 bg-red-900/60 border border-red-500/50 rounded-xl text-red-300 text-sm max-w-sm">
          {error}
        </div>
      )}

      <button
        onClick={handleStart}
        className="px-10 py-5 bg-red-600 hover:bg-red-500 active:bg-red-700 rounded-2xl text-2xl font-bold transition-all transform hover:scale-105 shadow-lg shadow-red-900"
      >
        Start Getting Roasted
      </button>

      <p className="mt-8 text-sm text-gray-600">
        Camera access required · 18+ content possible at high intensity
      </p>
    </div>
  );
}
