import * as THREE from "three";

export interface VerletChainConfig {
  gravity: [number, number, number];
  /** Velocity retention per step (0 = fully damped, 1 = no damping) */
  damping: number;
  /** 0–1: how strongly consecutive points maintain their rest distance */
  structuralStiffness: number;
  /** 0–1: how strongly each point pulls toward its rest/bone position */
  attachmentStiffness: number;
  /** Number of constraint solver iterations per step */
  constraintIterations: number;
  /** Multiplier on rest distance; 1.0 = inextensible, 1.2 = allows 20% stretch */
  maxStretch: number;
}

export const DEFAULT_VERLET_CONFIG: VerletChainConfig = {
  gravity: [0, -9.8, 0],
  damping: 0.95,
  structuralStiffness: 0.8,
  attachmentStiffness: 0.3,
  constraintIterations: 3,
  maxStretch: 1.2,
};

const MAX_SUB_DT = 0.016; // 16ms max per sub-step
const _tmp = new THREE.Vector3();
const _gravV = new THREE.Vector3();

export class VerletChain {
  /** Current simulation positions (world space) */
  positions: THREE.Vector3[];
  private prevPositions: THREE.Vector3[];
  /** Rest distances between consecutive points */
  private restLengths: number[];
  private config: VerletChainConfig;
  private pinnedRoot: THREE.Vector3 = new THREE.Vector3();

  constructor(initialPositions: THREE.Vector3[], config: VerletChainConfig) {
    this.config = { ...config };
    this.positions = initialPositions.map((p) => p.clone());
    this.prevPositions = initialPositions.map((p) => p.clone());
    this.restLengths = [];
    for (let i = 0; i < initialPositions.length - 1; i++) {
      this.restLengths.push(initialPositions[i].distanceTo(initialPositions[i + 1]));
    }
    if (initialPositions.length > 0) {
      this.pinnedRoot.copy(initialPositions[0]);
    }
  }

  /** Call before step() to update where the root bone is this frame */
  pinRoot(position: THREE.Vector3): void {
    this.pinnedRoot.copy(position);
  }

  /**
   * Advance the simulation by dt seconds.
   * dt is sub-stepped at max 16ms to prevent instability.
   */
  step(dt: number, restTargets: THREE.Vector3[]): void {
    let remaining = Math.min(dt, 0.05); // same 50ms cap as engine
    while (remaining > 0) {
      const subDt = Math.min(remaining, MAX_SUB_DT);
      this._substep(subDt, restTargets);
      remaining -= subDt;
    }
  }

  updateConfig(patch: Partial<VerletChainConfig>): void {
    this.config = { ...this.config, ...patch };
  }

  private _substep(dt: number, restTargets: THREE.Vector3[]): void {
    const { gravity, damping, structuralStiffness, attachmentStiffness, constraintIterations, maxStretch } = this.config;

    _gravV.set(gravity[0], gravity[1], gravity[2]);

    // 1. Verlet integration (skip root — pinned)
    for (let i = 1; i < this.positions.length; i++) {
      const pos = this.positions[i];
      const prev = this.prevPositions[i];

      // velocity = (pos - prev) * damping
      _tmp.copy(pos).sub(prev).multiplyScalar(damping);
      const newPos = pos.clone().add(_tmp).addScaledVector(_gravV, dt * dt);

      this.prevPositions[i].copy(pos);
      this.positions[i].copy(newPos);
    }

    // 2. Constraint solving
    for (let iter = 0; iter < constraintIterations; iter++) {
      // Structural: maintain distance between consecutive points
      for (let i = 0; i < this.positions.length - 1; i++) {
        const a = this.positions[i];
        const b = this.positions[i + 1];
        const restLen = this.restLengths[i] * maxStretch;
        const delta = _tmp.copy(b).sub(a);
        const dist = delta.length();
        if (dist < 1e-8) continue;

        const error = dist - restLen;
        if (error <= 0) continue; // only resolve stretching, allow compression

        const correction = delta.multiplyScalar((error / dist) * 0.5 * structuralStiffness);
        if (i > 0) a.add(correction);      // root is pinned
        b.sub(correction);
      }

      // Attachment: pull toward rest targets
      for (let i = 1; i < this.positions.length; i++) {
        if (i < restTargets.length) {
          this.positions[i].lerp(restTargets[i], attachmentStiffness * 0.1);
        }
      }
    }

    // 3. Pin root
    this.positions[0].copy(this.pinnedRoot);
    this.prevPositions[0].copy(this.pinnedRoot);
  }
}
