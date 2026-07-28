import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getDevUnlocked,
  isBuiltInDev,
  useDevUnlock,
} from "@/lib/devUnlock";

afterEach(() => {
  vi.unstubAllEnvs();
  localStorage.clear();
});

describe("production developer UI gate", () => {
  it("ignores the legacy localStorage unlock in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    localStorage.setItem("roastie:devUnlocked", "1");

    expect(isBuiltInDev()).toBe(false);
    expect(getDevUnlocked()).toBe(false);
    expect(useDevUnlock()).toBe(false);
  });

  it("keeps developer controls available in local development", () => {
    vi.stubEnv("NODE_ENV", "development");

    expect(isBuiltInDev()).toBe(true);
    expect(getDevUnlocked()).toBe(true);
    expect(useDevUnlock()).toBe(true);
  });
});
