import { describe, it, expect } from "vitest";
import { springStep, makeSpring, type SpringState } from "@/lib/spring";

describe("makeSpring", () => {
  it("creates a spring at the given initial value with zero velocity", () => {
    const s = makeSpring(5);
    expect(s.value).toBe(5);
    expect(s.velocity).toBe(0);
  });

  it("defaults to initial value 0", () => {
    const s = makeSpring();
    expect(s.value).toBe(0);
    expect(s.velocity).toBe(0);
  });
});

describe("springStep", () => {
  it("moves value toward target over time", () => {
    const initial = makeSpring(0);
    const stepped = springStep(initial, 10, 150, 20, 0.016);
    expect(stepped.value).toBeGreaterThan(0);
    expect(stepped.value).toBeLessThan(10);
  });

  it("converges to target with enough steps", () => {
    let state = makeSpring(0);
    for (let i = 0; i < 300; i++) {
      state = springStep(state, 1, 150, 20, 0.016);
    }
    expect(state.value).toBeCloseTo(1, 2);
    expect(state.velocity).toBeCloseTo(0, 2);
  });

  it("clamps dt to 50ms — large dt produces same result as 50ms dt", () => {
    const initial = makeSpring(0);
    const steppedClamped = springStep(initial, 10, 150, 20, 0.05);
    const steppedLarge = springStep(initial, 10, 150, 20, 1.0);
    expect(steppedLarge.value).toBeCloseTo(steppedClamped.value, 10);
    expect(steppedLarge.velocity).toBeCloseTo(steppedClamped.velocity, 10);
  });

  it("stays at target when already there with no velocity", () => {
    const atTarget: SpringState = { value: 5, velocity: 0 };
    const stepped = springStep(atTarget, 5, 150, 20, 0.016);
    expect(stepped.value).toBeCloseTo(5, 10);
    expect(stepped.velocity).toBeCloseTo(0, 10);
  });

  it("damping reduces velocity when overshooting", () => {
    // Moving fast toward target — high damping should slow it down
    const state: SpringState = { value: 2, velocity: 10 };
    const stepped = springStep(state, 0, 150, 20, 0.016);
    expect(Math.abs(stepped.velocity)).toBeLessThan(Math.abs(state.velocity));
  });
});
