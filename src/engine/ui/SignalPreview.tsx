"use client";
import { getAllSignalDefs } from "../registry";
import { useRigEditStore } from "../store/RigEditStore";

/**
 * Auto-generates preview sliders from all registered component SignalDefs.
 * Writes to RigEditStore.previewSignals, which RigRuntimeBridge reads each frame.
 */
export default function SignalPreview() {
  const previewSignals = useRigEditStore((s) => s.previewSignals);
  const setPreviewSignal = useRigEditStore((s) => s.setPreviewSignal);
  const defs = getAllSignalDefs();

  if (defs.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="text-[10px] text-white/30 uppercase tracking-wider">Signal Preview</div>
      {defs.map((sig) => {
        const val = previewSignals[sig.key] ?? sig.default;
        return (
          <div key={sig.key} className="flex items-center gap-2 text-xs">
            <span className="text-white/50 w-28 shrink-0">{sig.label}</span>
            <input
              type="range"
              min={sig.min}
              max={sig.max}
              step={(sig.max - sig.min) / 100}
              value={val}
              onChange={(e) => setPreviewSignal(sig.key, parseFloat(e.target.value))}
              className="flex-1 accent-orange-400 h-1"
            />
            <span className="text-white/60 w-10 text-right tabular-nums">
              {val.toFixed(2)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
