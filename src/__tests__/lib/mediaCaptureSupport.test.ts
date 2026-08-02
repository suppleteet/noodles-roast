import { describe, expect, it } from "vitest";
import { mediaCaptureBlockMessage } from "@/lib/mediaCaptureSupport";

describe("mediaCaptureBlockMessage", () => {
  it("explains how to make a private-LAN HTTP preview usable on mobile", () => {
    const message = mediaCaptureBlockMessage({
      isSecureContext: false,
      hasGetUserMedia: false,
      origin: "http://10.0.0.36:3000",
    });

    expect(message).toContain("http://10.0.0.36:3000");
    expect(message).toContain("require HTTPS");
    expect(message).toContain("unsafely-treat-insecure-origin-as-secure");
  });

  it("reports missing media capture on a secure origin", () => {
    expect(mediaCaptureBlockMessage({
      isSecureContext: true,
      hasGetUserMedia: false,
      origin: "https://example.test",
    })).toContain("does not expose camera and microphone capture");
  });

  it("allows supported secure origins", () => {
    expect(mediaCaptureBlockMessage({
      isSecureContext: true,
      hasGetUserMedia: true,
      origin: "https://example.test",
    })).toBeNull();
  });
});
