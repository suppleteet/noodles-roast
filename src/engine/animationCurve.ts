import type { CurveKeyframe } from "./types";

/**
 * Evaluate a cubic hermite spline at parameter t.
 * Keyframes must be sorted by time ascending.
 * Returns the value at t, clamped to the first/last keyframe outside the range.
 */
export function evaluateCurve(keyframes: CurveKeyframe[], t: number): number {
  if (keyframes.length === 0) return 0;
  if (keyframes.length === 1) return keyframes[0].value;

  // Clamp outside range
  if (t <= keyframes[0].time) return keyframes[0].value;
  if (t >= keyframes[keyframes.length - 1].time) return keyframes[keyframes.length - 1].value;

  // Find surrounding keyframes
  let lo = 0;
  let hi = keyframes.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keyframes[mid].time <= t) lo = mid;
    else hi = mid;
  }

  const k0 = keyframes[lo];
  const k1 = keyframes[hi];
  const span = k1.time - k0.time;
  if (span < 1e-10) return k0.value;

  // Local parameter 0–1
  const u = (t - k0.time) / span;

  // Cubic hermite basis
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;

  return (
    h00 * k0.value +
    h10 * span * k0.outTangent +
    h01 * k1.value +
    h11 * span * k1.inTangent
  );
}

/** Linear 0→1 default (two keyframes) */
export function createDefaultCurve(): CurveKeyframe[] {
  return [
    { time: 0, value: 0, inTangent: 1, outTangent: 1 },
    { time: 1, value: 1, inTangent: 1, outTangent: 1 },
  ];
}

/** Insert a keyframe sorted by time, auto-computing Catmull-Rom tangents */
export function addKeyframe(
  curve: CurveKeyframe[],
  time: number,
  value: number
): CurveKeyframe[] {
  const next = [...curve, { time, value, inTangent: 0, outTangent: 0 }].sort(
    (a, b) => a.time - b.time
  );
  return recomputeTangents(next);
}

export function removeKeyframe(curve: CurveKeyframe[], index: number): CurveKeyframe[] {
  const next = curve.filter((_, i) => i !== index);
  return recomputeTangents(next);
}

/**
 * Recompute Catmull-Rom tangents for all keyframes.
 * Endpoints use one-sided finite differences.
 */
function recomputeTangents(curve: CurveKeyframe[]): CurveKeyframe[] {
  if (curve.length < 2) return curve;
  return curve.map((kf, i) => {
    let tangent: number;
    if (i === 0) {
      const dt = curve[1].time - curve[0].time;
      tangent = dt > 0 ? (curve[1].value - curve[0].value) / dt : 0;
    } else if (i === curve.length - 1) {
      const dt = curve[i].time - curve[i - 1].time;
      tangent = dt > 0 ? (curve[i].value - curve[i - 1].value) / dt : 0;
    } else {
      const dt = curve[i + 1].time - curve[i - 1].time;
      tangent = dt > 0 ? (curve[i + 1].value - curve[i - 1].value) / dt : 0;
    }
    return { ...kf, inTangent: tangent, outTangent: tangent };
  });
}
