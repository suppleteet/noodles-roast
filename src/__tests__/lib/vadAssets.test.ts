import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workspacePath = (...segments: string[]): string =>
  resolve(process.cwd(), ...segments);

describe("Silero VAD browser assets", () => {
  it("ships the worklet expected by @ricky0123/vad-web", () => {
    const publicWorklet = readFileSync(
      workspacePath("public", "vad.worklet.bundle.min.js"),
      "utf8",
    ).trimEnd();
    const packageWorklet = readFileSync(
      workspacePath(
        "node_modules",
        "@ricky0123",
        "vad-web",
        "dist",
        "vad.worklet.bundle.min.js",
      ),
      "utf8",
    ).trimEnd();

    expect(publicWorklet).toBe(packageWorklet);
  });

  it.each([
    [
      "silero_vad_v5.onnx",
      ["node_modules", "@ricky0123", "vad-web", "dist", "silero_vad_v5.onnx"],
    ],
    [
      "ort-wasm-simd-threaded.mjs",
      ["node_modules", "onnxruntime-web", "dist", "ort-wasm-simd-threaded.mjs"],
    ],
    [
      "ort-wasm-simd-threaded.wasm",
      ["node_modules", "onnxruntime-web", "dist", "ort-wasm-simd-threaded.wasm"],
    ],
  ])("keeps public/%s synchronized with its installed package", (publicName, sourceParts) => {
    const publicAsset = readFileSync(workspacePath("public", publicName));
    const packageAsset = readFileSync(workspacePath(...sourceParts));

    expect(publicAsset.equals(packageAsset)).toBe(true);
  });
});
