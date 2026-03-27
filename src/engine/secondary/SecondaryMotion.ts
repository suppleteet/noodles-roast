import type { SecondaryMotionConfig } from "../types";

const MAX_DT = 0.05; // 50ms cap — matches spring.ts:21

/**
 * Scalar secondary motion with four modes: none, damp, spring, frameDelay.
 * Embed one instance per axis/value in a component and call tick() each frame.
 */
export class SecondaryMotion {
  private config: SecondaryMotionConfig;
  private current: number = 0;
  private velocity: number = 0;
  // Circular buffer for frameDelay
  private buffer: number[] = [];
  private bufferHead: number = 0;
  private initialized: boolean = false;

  constructor(config: SecondaryMotionConfig) {
    this.config = { ...config };
  }

  setStart(value: number): void {
    this.current = value;
    this.velocity = 0;
    this.bufferHead = 0;
    const frames = Math.max(1, Math.round(this.config.delayFrames));
    this.buffer = new Array(frames).fill(value) as number[];
    this.initialized = true;
  }

  tick(target: number, dt: number): number {
    if (!this.initialized) this.setStart(target);

    const { mode, weight } = this.config;
    if (mode === "none" || weight <= 0) return target;

    const clampedDt = Math.min(dt, MAX_DT);
    let simResult: number;

    switch (mode) {
      case "damp":
        simResult = this._tickDamp(target, clampedDt);
        break;
      case "spring":
        simResult = this._tickSpring(target, clampedDt);
        break;
      case "frameDelay":
        simResult = this._tickFrameDelay(target, clampedDt);
        break;
      default:
        return target;
    }

    // Blend: weight=0 → target, weight=1 → simResult
    return target + (simResult - target) * weight;
  }

  updateConfig(patch: Partial<SecondaryMotionConfig>): void {
    const prev = this.config;
    this.config = { ...prev, ...patch };
    // Resize circular buffer if delayFrames changed
    if (patch.delayFrames !== undefined && patch.delayFrames !== prev.delayFrames) {
      const frames = Math.max(1, Math.round(this.config.delayFrames));
      this.buffer = new Array(frames).fill(this.current) as number[];
      this.bufferHead = 0;
    }
  }

  private _tickDamp(target: number, dt: number): number {
    const smoothing = Math.max(this.config.smoothing, 0.001);
    this.current += (target - this.current) * (1 - Math.exp(-dt / smoothing));
    return this.current;
  }

  private _tickSpring(target: number, dt: number): number {
    const { stiffness, damping, gravity, mass } = this.config;
    const safeMass = Math.max(mass, 0.0001);
    const force = stiffness * (target - this.current) - damping * this.velocity + gravity;
    this.velocity += (force / safeMass) * dt;
    this.current += this.velocity * dt;
    return this.current;
  }

  private _tickFrameDelay(target: number, dt: number): number {
    const frames = this.buffer.length;
    // Write current target into buffer
    this.buffer[this.bufferHead] = target;
    // Read from the oldest slot
    const delayedTarget = this.buffer[(this.bufferHead + 1) % frames];
    this.bufferHead = (this.bufferHead + 1) % frames;
    // Smooth toward delayed target
    const smoothing = Math.max(this.config.smoothing, 0.001);
    this.current += (delayedTarget - this.current) * (1 - Math.exp(-dt / smoothing));
    return this.current;
  }
}
