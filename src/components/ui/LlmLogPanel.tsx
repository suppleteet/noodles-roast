"use client";
import { useEffect, useRef } from "react";
import { useSessionStore } from "@/store/useSessionStore";

/**
 * Dev panel (left column) showing the legible LLM back-and-forth:
 *   → what the puppet's brain asked the model for (context + key inputs)
 *   ← the plain text it got back (joke / question / line — never JSON)
 *
 * Tall by design and auto-scrolls to the newest line so you can always see
 * what just happened without scrolling.
 */
export default function LlmLogPanel() {
  const llmLog = useSessionStore((s) => s.llmLog);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the latest entry as calls/responses come in.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [llmLog.length]);

  return (
    <div className="bg-black/80 border border-yellow-400/40 rounded p-2 font-mono text-[10px] leading-snug pointer-events-auto overflow-y-auto max-h-[78vh] min-h-[8rem]">
      <div className="text-yellow-500 mb-1 sticky top-0 bg-black/80">LLM ({llmLog.length})</div>
      {llmLog.length === 0 ? (
        <div className="text-white/25 italic">No LLM calls yet</div>
      ) : (
        llmLog.map((e, i) => (
          <div
            key={i}
            className={`mb-1 ${e.dir === "→" ? "text-cyan-300/70" : "text-orange-200/90"}`}
          >
            <span className={e.dir === "→" ? "text-cyan-500" : "text-orange-400"}>{e.dir}</span>{" "}
            <span className="text-white/35">{e.label}</span>{" "}
            {e.text}
          </div>
        ))
      )}
      <div ref={bottomRef} />
    </div>
  );
}
