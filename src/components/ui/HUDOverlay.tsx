"use client";
import { useSessionStore } from "@/store/useSessionStore";

export default function HUDOverlay() {
  const setPhase = useSessionStore((s) => s.setPhase);
  const burnIntensity = useSessionStore((s) => s.burnIntensity);
  const sessionMode = useSessionStore((s) => s.sessionMode);
  const isSpeaking = useSessionStore((s) => s.isSpeaking);
  const isListening = useSessionStore((s) => s.isListening);
  const isUserSpeaking = useSessionStore((s) => s.isUserSpeaking);
  const transcript = useSessionStore((s) => s.transcript);

  const isConversation = sessionMode === "conversation";

  return (
    <div className="absolute inset-0 pointer-events-none z-10" data-testid="hud-overlay">
      {/* Top bar */}
      <div className="absolute top-4 left-4 flex items-center gap-2 pointer-events-none">
        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        <span className="text-xs font-bold text-white/70 uppercase tracking-wider">
          Live · Burn {burnIntensity}/5
          {isConversation && " · Conversation"}
        </span>
        {isSpeaking && (
          <span className="text-xs text-orange-400 font-bold uppercase tracking-wider animate-pulse ml-2">
            Speaking…
          </span>
        )}
        {isConversation && isListening && !isSpeaking && (
          <span className="text-xs text-green-400 font-bold uppercase tracking-wider ml-2">
            Listening…
          </span>
        )}
        {isConversation && isUserSpeaking && (
          <span className="text-xs text-cyan-400 font-bold uppercase tracking-wider animate-pulse ml-2">
            You're talking…
          </span>
        )}
      </div>

      {/* Transcript (conversation mode debug) */}
      {isConversation && transcript && (
        <div className="absolute top-10 left-4 max-w-[280px] pointer-events-none">
          <div className="bg-black/60 rounded px-2 py-1 font-mono text-[10px] text-white/50 leading-tight truncate">
            {transcript.slice(-120)}
          </div>
        </div>
      )}

      {/* Stop button */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 pointer-events-auto">
        <button
          onClick={() => setPhase("stopped")}
          className="px-8 py-3 bg-white/10 hover:bg-white/20 backdrop-blur border border-white/20 rounded-full text-white font-bold transition-all"
        >
          Stop Session
        </button>
      </div>
    </div>
  );
}
