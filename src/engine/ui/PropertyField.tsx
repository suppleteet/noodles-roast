"use client";
import { useState } from "react";
import type { PropertyDef, SecondaryMotionConfig, CurveKeyframe } from "../types";
import BoneSelector from "./BoneSelector";
import SecondaryMotionField from "./SecondaryMotionField";
import AnimationCurveEditor from "./AnimationCurveEditor";

interface Props {
  def: PropertyDef;
  value: unknown;
  boneNames: string[];
  onChange: (key: string, value: unknown) => void;
}

export default function PropertyField({ def, value, boneNames, onChange }: Props) {
  const [curveOpen, setCurveOpen] = useState(false);

  const labelClass = "text-white/50 text-xs w-32 shrink-0 pt-0.5";
  const inputClass = "flex-1 bg-black/60 border border-white/20 rounded text-white/80 text-xs px-2 py-1";

  switch (def.type) {
    case "float": {
      const num = (value as number) ?? (def.default as number) ?? 0;
      const min = def.min ?? 0;
      const max = def.max ?? 1;
      const step = def.step ?? 0.01;
      return (
        <div className="flex items-center gap-2">
          <span className={labelClass}>{def.label}</span>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={num}
            onChange={(e) => onChange(def.key, parseFloat(e.target.value))}
            className="flex-1 accent-orange-400 h-1"
          />
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={num}
            onChange={(e) => onChange(def.key, parseFloat(e.target.value))}
            className="w-16 bg-black/60 border border-white/20 rounded text-white/80 text-xs px-1 py-0.5 text-right tabular-nums"
          />
        </div>
      );
    }

    case "bool": {
      const bool = (value as boolean) ?? false;
      return (
        <div className="flex items-center gap-2">
          <span className={labelClass}>{def.label}</span>
          <input
            type="checkbox"
            checked={bool}
            onChange={(e) => onChange(def.key, e.target.checked)}
            className="accent-orange-400 w-3.5 h-3.5"
          />
        </div>
      );
    }

    case "string": {
      const str = (value as string) ?? "";
      if (def.bone) {
        return (
          <div className="flex items-center gap-2">
            <span className={labelClass}>{def.label}</span>
            <div className="flex-1">
              <BoneSelector boneNames={boneNames} value={str} onChange={(v) => onChange(def.key, v)} />
            </div>
          </div>
        );
      }
      return (
        <div className="flex items-center gap-2">
          <span className={labelClass}>{def.label}</span>
          <input
            type="text"
            value={str}
            onChange={(e) => onChange(def.key, e.target.value)}
            className={inputClass}
          />
        </div>
      );
    }

    case "select": {
      const sel = (value as string) ?? (def.default as string) ?? "";
      return (
        <div className="flex items-center gap-2">
          <span className={labelClass}>{def.label}</span>
          <select
            value={sel}
            onChange={(e) => onChange(def.key, e.target.value)}
            className={`${inputClass} cursor-pointer`}
          >
            {(def.options ?? []).map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      );
    }

    case "vec3": {
      const vec = (value as [number, number, number]) ?? [0, 0, 0];
      const min = def.min ?? -100;
      const max = def.max ?? 100;
      const step = def.step ?? 0.01;
      return (
        <div className="flex flex-col gap-1">
          <span className={`${labelClass} pt-0`}>{def.label}</span>
          {(["X", "Y", "Z"] as const).map((axis, i) => (
            <div key={axis} className="flex items-center gap-2 pl-4">
              <span className="text-white/30 text-xs w-4">{axis}</span>
              <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={vec[i]}
                onChange={(e) => {
                  const next: [number, number, number] = [...vec] as [number, number, number];
                  next[i] = parseFloat(e.target.value);
                  onChange(def.key, next);
                }}
                className="flex-1 accent-orange-400 h-1"
              />
              <input
                type="number"
                min={min}
                max={max}
                step={step}
                value={vec[i]}
                onChange={(e) => {
                  const next: [number, number, number] = [...vec] as [number, number, number];
                  next[i] = parseFloat(e.target.value);
                  onChange(def.key, next);
                }}
                className="w-16 bg-black/60 border border-white/20 rounded text-white/80 text-xs px-1 py-0.5 text-right tabular-nums"
              />
            </div>
          ))}
        </div>
      );
    }

    case "curve": {
      const curve = (value as CurveKeyframe[]) ?? [];
      return (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className={labelClass}>{def.label}</span>
            <button
              onClick={() => setCurveOpen((o) => !o)}
              className="text-xs text-orange-400 hover:text-orange-300 border border-orange-400/30 rounded px-2 py-0.5"
            >
              {curveOpen ? "Close" : "Edit Curve"}
            </button>
          </div>
          {curveOpen && (
            <div className="pl-2 pt-1">
              <AnimationCurveEditor
                value={curve}
                onChange={(v) => onChange(def.key, v)}
              />
              <p className="text-white/30 text-[10px] mt-1">Click to add • Right-click to remove</p>
            </div>
          )}
        </div>
      );
    }

    case "secondaryMotion": {
      const sm = (value as SecondaryMotionConfig) ?? undefined;
      return (
        <div className="flex flex-col gap-1">
          <span className={`${labelClass} pt-0`}>{def.label}</span>
          <div className="pl-2">
            <SecondaryMotionField
              value={sm ?? { mode: "none", weight: 1, smoothing: 0.05, mass: 0.5, stiffness: 10, damping: 5, gravity: 0, delayFrames: 3 }}
              onChange={(v) => onChange(def.key, v)}
            />
          </div>
        </div>
      );
    }

    default:
      return null;
  }
}
