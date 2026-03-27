"use client";
import { useCallback, useRef, useState } from "react";
import type { CurveKeyframe } from "../types";
import { evaluateCurve, addKeyframe, removeKeyframe } from "../animationCurve";

interface Props {
  value: CurveKeyframe[];
  onChange: (value: CurveKeyframe[]) => void;
  width?: number;
  height?: number;
}

const PAD = 12;

function curveToSvgPath(keyframes: CurveKeyframe[], w: number, h: number): string {
  if (keyframes.length < 2) return "";
  const steps = 80;
  const t0 = keyframes[0].time;
  const t1 = keyframes[keyframes.length - 1].time;
  const tRange = t1 - t0 || 1;

  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = t0 + (i / steps) * tRange;
    const v = evaluateCurve(keyframes, t);
    const x = PAD + ((t - t0) / tRange) * (w - PAD * 2);
    const y = PAD + (1 - v) * (h - PAD * 2);
    pts.push(`${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return pts.join(" ");
}

export default function AnimationCurveEditor({ value, onChange, width = 280, height = 160 }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  const toSvgCoords = useCallback(
    (clientX: number, clientY: number) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return { t: 0, v: 0 };
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const t = (x - PAD) / (width - PAD * 2);
      const v = 1 - (y - PAD) / (height - PAD * 2);
      return { t: Math.max(0, Math.min(1, t)), v: Math.max(0, Math.min(1, v)) };
    },
    [width, height]
  );

  const handleSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (dragging !== null) return;
    const { t, v } = toSvgCoords(e.clientX, e.clientY);
    onChange(addKeyframe(value, t, v));
  };

  const handleKfMouseDown = (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    setDragging(index);
  };

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (dragging === null) return;
      const { t, v } = toSvgCoords(e.clientX, e.clientY);
      const next = value.map((kf, i) =>
        i === dragging ? { ...kf, time: t, value: v } : kf
      );
      onChange(next.sort((a, b) => a.time - b.time));
    },
    [dragging, value, onChange, toSvgCoords]
  );

  const handleMouseUp = () => setDragging(null);

  const handleKfRightClick = (e: React.MouseEvent, index: number) => {
    e.preventDefault();
    if (value.length <= 2) return; // keep minimum 2 keyframes
    onChange(removeKeyframe(value, index));
  };

  const drawW = width - PAD * 2;
  const drawH = height - PAD * 2;
  const t0 = value[0]?.time ?? 0;
  const t1 = value[value.length - 1]?.time ?? 1;
  const tRange = t1 - t0 || 1;

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      className="bg-black/80 border border-white/20 rounded cursor-crosshair select-none"
      onClick={handleSvgClick}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map((v) => (
        <line
          key={v}
          x1={PAD}
          x2={PAD + drawW}
          y1={PAD + (1 - v) * drawH}
          y2={PAD + (1 - v) * drawH}
          stroke="#ffffff18"
          strokeDasharray="3 3"
        />
      ))}
      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
        <line
          key={t}
          x1={PAD + t * drawW}
          x2={PAD + t * drawW}
          y1={PAD}
          y2={PAD + drawH}
          stroke="#ffffff18"
          strokeDasharray="3 3"
        />
      ))}

      {/* Curve path */}
      <path
        d={curveToSvgPath(value, width, height)}
        fill="none"
        stroke="#f97316"
        strokeWidth={1.5}
      />

      {/* Keyframe handles */}
      {value.map((kf, i) => {
        const x = PAD + ((kf.time - t0) / tRange) * drawW;
        const y = PAD + (1 - kf.value) * drawH;
        return (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={5}
            fill={dragging === i ? "#f97316" : "#fff"}
            stroke="#f97316"
            strokeWidth={1.5}
            className="cursor-grab"
            onMouseDown={(e) => handleKfMouseDown(e, i)}
            onContextMenu={(e) => handleKfRightClick(e, i)}
          />
        );
      })}
    </svg>
  );
}
