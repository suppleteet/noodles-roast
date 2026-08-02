"use client";
import { useSessionStore } from "@/store/useSessionStore";
import type { BurnIntensity } from "@/lib/prompts";

const INTENSITY_LABELS: Record<BurnIntensity, { label: string; desc: string; color: string }> = {
  1: { label: "Warm Hug", desc: "Gentle teasing", color: "bg-green-700 hover:bg-green-600" },
  2: { label: "Light Burn", desc: "Friendly jabs", color: "bg-lime-700 hover:bg-lime-600" },
  3: { label: "Medium Heat", desc: "Pointed roasting", color: "bg-yellow-700 hover:bg-yellow-600" },
  4: { label: "Spicy", desc: "Sharp & savage", color: "bg-orange-700 hover:bg-orange-600" },
  5: { label: "MAXIMUM BURN", desc: "Absolutely brutal", color: "bg-red-700 hover:bg-red-600" },
};

export default function ConsentScreen() {
  const burnIntensity = useSessionStore((s) => s.burnIntensity);
  const setBurnIntensity = useSessionStore((s) => s.setBurnIntensity);
  const setPhase = useSessionStore((s) => s.setPhase);

  function handleReady() {
    setPhase("requesting-permissions", "CONSENT_ACCEPTED");
  }

  return (
    <div className="consent-screen">
      <header className="consent-header">
        <button
          type="button"
          onClick={() => setPhase("idle", "CONSENT_BACK")}
          className="consent-back-button"
          aria-label="Back to call setup"
        >
          <span aria-hidden="true">←</span>
        </button>
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-orange-300/65">Before connecting</p>
          <h2 className="mt-1 text-3xl font-black tracking-tight">Set your burn level</h2>
          <p className="mt-1 text-sm text-white/45">Locked for this call. Choose wisely.</p>
        </div>
      </header>

      <div className="consent-level-grid" role="group" aria-label="Burn intensity">
        {([1, 2, 3, 4, 5] as BurnIntensity[]).map((lvl) => {
          const cfg = INTENSITY_LABELS[lvl];
          const selected = burnIntensity === lvl;
          return (
            <button
              key={lvl}
              onClick={() => setBurnIntensity(lvl)}
              aria-label={`${lvl}: ${cfg.label} — ${cfg.desc}`}
              aria-pressed={selected}
              className={`consent-level ${cfg.color} ${
                selected
                  ? "border-white/80 opacity-100 shadow-lg"
                  : "border-white/5 opacity-55"
              }`}
            >
              <span className="text-xl font-black">{lvl}</span>
              <span className="consent-level-label">{cfg.label}</span>
              <span className="consent-level-desc">{cfg.desc}</span>
            </button>
          );
        })}
      </div>

      <div className="consent-disclosure">
        <p>⚠️ <strong>Content Warning:</strong> This app generates comedic roasts. At higher intensities the content may be crude or offensive.</p>
        <p>📷 <strong>Camera Disclosure:</strong> Your webcam feed is used only to generate the roast. Frames are sent to an AI vision API. Nothing is stored.</p>
        <p>🎥 <strong>Recording:</strong> A video of the session is generated locally for sharing. It never leaves your device unless you share it.</p>
      </div>

      <div className="consent-actions">
        <button
          onClick={handleReady}
          className="consent-connect-button"
        >
          Connect the call
        </button>
        <p className="text-center text-[10px] font-bold uppercase tracking-[0.18em] text-white/30">
          Camera + mic permission comes next
        </p>
      </div>
    </div>
  );
}
