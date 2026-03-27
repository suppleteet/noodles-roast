"use client";
import type { SecondaryMotionConfig, SecondaryMotionMode } from "../types";
import { DEFAULT_SECONDARY_MOTION_CONFIG } from "../types";

interface Props {
  value: SecondaryMotionConfig;
  onChange: (value: SecondaryMotionConfig) => void;
}

const MODES: { label: string; value: SecondaryMotionMode }[] = [
  { label: "None", value: "none" },
  { label: "Damp", value: "damp" },
  { label: "Spring", value: "spring" },
  { label: "Frame Delay", value: "frameDelay" },
];

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-white/50 w-24 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1 accent-orange-400 h-1"
      />
      <span className="text-white/70 w-10 text-right tabular-nums">
        {value.toFixed(step < 0.1 ? 2 : step < 1 ? 1 : 0)}
      </span>
    </div>
  );
}

export default function SecondaryMotionField({ value, onChange }: Props) {
  const cfg = { ...DEFAULT_SECONDARY_MOTION_CONFIG, ...value };
  const set = (patch: Partial<SecondaryMotionConfig>) => onChange({ ...cfg, ...patch });

  return (
    <div className="flex flex-col gap-1.5 pl-2 border-l border-white/10">
      {/* Mode selector */}
      <div className="flex items-center gap-2 text-xs">
        <span className="text-white/50 w-24 shrink-0">Mode</span>
        <select
          value={cfg.mode}
          onChange={(e) => set({ mode: e.target.value as SecondaryMotionMode })}
          className="flex-1 bg-black/60 border border-white/20 rounded text-white/80 px-1 py-0.5 cursor-pointer"
        >
          {MODES.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </div>

      {cfg.mode !== "none" && (
        <Slider label="Weight" value={cfg.weight} min={0} max={1} step={0.01} onChange={(v) => set({ weight: v })} />
      )}

      {cfg.mode === "damp" && (
        <Slider label="Smoothing" value={cfg.smoothing} min={0} max={1.5} step={0.01} onChange={(v) => set({ smoothing: v })} />
      )}

      {cfg.mode === "spring" && (<>
        <Slider label="Mass" value={cfg.mass} min={0.01} max={10} step={0.01} onChange={(v) => set({ mass: v })} />
        <Slider label="Stiffness" value={cfg.stiffness} min={0} max={100} step={1} onChange={(v) => set({ stiffness: v })} />
        <Slider label="Damping" value={cfg.damping} min={0} max={30} step={0.5} onChange={(v) => set({ damping: v })} />
        <Slider label="Gravity" value={cfg.gravity} min={-5} max={5} step={0.1} onChange={(v) => set({ gravity: v })} />
      </>)}

      {cfg.mode === "frameDelay" && (<>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-white/50 w-24 shrink-0">Delay Frames</span>
          <input
            type="number"
            min={0}
            max={72}
            step={1}
            value={cfg.delayFrames}
            onChange={(e) => set({ delayFrames: parseInt(e.target.value, 10) || 0 })}
            className="flex-1 bg-black/60 border border-white/20 rounded text-white/80 text-xs px-2 py-0.5"
          />
        </div>
        <Slider label="Smoothing" value={cfg.smoothing} min={0} max={1.5} step={0.01} onChange={(v) => set({ smoothing: v })} />
      </>)}
    </div>
  );
}
