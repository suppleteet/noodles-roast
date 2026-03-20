import { describe, it, expect, beforeEach } from "vitest";
import { useSessionStore } from "@/store/useSessionStore";

beforeEach(() => {
  useSessionStore.getState().reset();
});

describe("initial state", () => {
  it("starts in idle phase", () => {
    expect(useSessionStore.getState().phase).toBe("idle");
  });

  it("starts with burnIntensity 3", () => {
    expect(useSessionStore.getState().burnIntensity).toBe(3);
  });

  it("starts not speaking", () => {
    expect(useSessionStore.getState().isSpeaking).toBe(false);
  });

  it("starts with zero audioAmplitude", () => {
    expect(useSessionStore.getState().audioAmplitude).toBe(0);
  });

  it("starts with empty timingLog", () => {
    expect(useSessionStore.getState().timingLog).toHaveLength(0);
  });

  it("starts with no error", () => {
    expect(useSessionStore.getState().error).toBeNull();
  });

  it("starts with empty observations", () => {
    expect(useSessionStore.getState().observations).toHaveLength(0);
  });
});

describe("phase transitions", () => {
  it("setPhase transitions through all valid phases", () => {
    const { setPhase } = useSessionStore.getState();
    const phases = ["consent", "requesting-permissions", "roasting", "stopped", "sharing"] as const;
    for (const phase of phases) {
      setPhase(phase);
      expect(useSessionStore.getState().phase).toBe(phase);
    }
  });
});

describe("timingLog", () => {
  it("logTiming appends entries", () => {
    const { logTiming } = useSessionStore.getState();
    logTiming("entry one");
    logTiming("entry two");
    const { timingLog } = useSessionStore.getState();
    expect(timingLog).toContain("entry one");
    expect(timingLog).toContain("entry two");
  });

  it("caps at 50 entries (slice(-49) + 1 new)", () => {
    const { logTiming } = useSessionStore.getState();
    for (let i = 0; i < 60; i++) {
      logTiming(`entry ${i}`);
    }
    expect(useSessionStore.getState().timingLog).toHaveLength(50);
  });

  it("clearTimingLog empties the log", () => {
    const { logTiming, clearTimingLog } = useSessionStore.getState();
    logTiming("something");
    clearTimingLog();
    expect(useSessionStore.getState().timingLog).toHaveLength(0);
  });
});

describe("motion state", () => {
  it("setActiveMotionState updates state and intensity together", () => {
    useSessionStore.getState().setActiveMotionState("laugh", 0.9);
    const { activeMotionState, motionIntensity } = useSessionStore.getState();
    expect(activeMotionState).toBe("laugh");
    expect(motionIntensity).toBe(0.9);
  });
});

describe("observations", () => {
  it("setObservations replaces the array", () => {
    useSessionStore.getState().setObservations(["big nose", "tired eyes"]);
    expect(useSessionStore.getState().observations).toEqual(["big nose", "tired eyes"]);

    useSessionStore.getState().setObservations(["new obs"]);
    expect(useSessionStore.getState().observations).toHaveLength(1);
  });
});

describe("reset", () => {
  it("returns all fields to initial values", () => {
    const store = useSessionStore.getState();
    store.setPhase("roasting");
    store.setBurnIntensity(5);
    store.setIsSpeaking(true);
    store.setError("something went wrong");
    store.logTiming("log entry");
    store.setObservations(["obs1"]);
    store.setActiveMotionState("laugh", 1.0);

    store.reset();

    const after = useSessionStore.getState();
    expect(after.phase).toBe("idle");
    expect(after.burnIntensity).toBe(3);
    expect(after.isSpeaking).toBe(false);
    expect(after.error).toBeNull();
    expect(after.timingLog).toHaveLength(0);
    expect(after.observations).toHaveLength(0);
  });
});
