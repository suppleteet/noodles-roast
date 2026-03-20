export interface SpringState {
  value: number;
  velocity: number;
}

/**
 * Critically damped spring step.
 * @param state  current { value, velocity }
 * @param target desired value
 * @param stiffness  spring constant k (higher = snappier)
 * @param damping    damping ratio (2*sqrt(k) for critical)
 * @param dt         delta time in seconds
 */
export function springStep(
  state: SpringState,
  target: number,
  stiffness: number,
  damping: number,
  dt: number
): SpringState {
  const clampedDt = Math.min(dt, 0.05); // cap at 50ms to prevent blowup
  const force = stiffness * (target - state.value) - damping * state.velocity;
  const velocity = state.velocity + force * clampedDt;
  const value = state.value + velocity * clampedDt;
  return { value, velocity };
}

export function makeSpring(initial = 0): SpringState {
  return { value: initial, velocity: 0 };
}
