import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  getDevUnlocked,
  isBuiltInDev,
  lockDevUi,
  unlockDevUi,
  useDevUnlock,
} from "@/lib/devUnlock";

afterEach(() => {
  lockDevUi();
  vi.unstubAllEnvs();
  localStorage.clear();
});

describe("developer UI gate", () => {
  it("starts locked in production and ignores the legacy localStorage flag", () => {
    vi.stubEnv("NODE_ENV", "production");
    localStorage.setItem("roastie:devUnlocked", "1");

    expect(isBuiltInDev()).toBe(false);
    expect(getDevUnlocked()).toBe(false);
  });

  it("starts locked in local development too", () => {
    vi.stubEnv("NODE_ENV", "development");

    expect(isBuiltInDev()).toBe(true);
    expect(getDevUnlocked()).toBe(false);
  });

  it("reactively unlocks and locks developer controls for this page load", () => {
    const { result } = renderHook(() => useDevUnlock());
    expect(result.current).toBe(false);

    act(() => unlockDevUi());
    expect(result.current).toBe(true);
    expect(getDevUnlocked()).toBe(true);

    act(() => lockDevUi());
    expect(result.current).toBe(false);
  });
});
