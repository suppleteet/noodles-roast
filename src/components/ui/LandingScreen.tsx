"use client";
import { useSessionStore } from "@/store/useSessionStore";

export default function LandingScreen() {
  const setPhase = useSessionStore((s) => s.setPhase);
  const error = useSessionStore((s) => s.error);
  const setError = useSessionStore((s) => s.setError);

  function handleStart() {
    setError(null);
    setPhase("requesting-permissions");
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-black text-white px-4 text-center">
      {error && (
        <div className="mb-6 px-5 py-3 bg-red-900/60 border border-red-500/50 rounded-xl text-red-300 text-sm max-w-sm">
          {error}
        </div>
      )}

      <button
        onClick={handleStart}
        className="px-10 py-5 bg-red-600 hover:bg-red-500 active:bg-red-700 rounded-2xl text-2xl font-bold transition-all transform hover:scale-105 shadow-lg shadow-red-900"
      >
        Roast Me
      </button>
    </div>
  );
}
