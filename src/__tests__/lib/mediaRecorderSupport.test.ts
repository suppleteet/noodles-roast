import { describe, expect, it } from "vitest";
import {
  chooseRecorderFormat,
  contentTypeForVideoFilename,
  extensionForMimeType,
  isSafeVideoFilename,
  recommendedVideoBitsPerSecond,
} from "@/lib/mediaRecorderSupport";

describe("mediaRecorderSupport", () => {
  it("picks the first supported MP4 candidate", () => {
    const format = chooseRecorderFormat((mime) => mime === "video/mp4");
    expect(format?.mimeType).toBe("video/mp4");
    expect(format?.extension).toBe("mp4");
  });

  it("returns null when no MP4 candidate is supported", () => {
    expect(chooseRecorderFormat(() => false)).toBeNull();
  });

  it("returns null when support probing throws", () => {
    expect(
      chooseRecorderFormat(() => {
        throw new Error("probe failed");
      }),
    ).toBeNull();
  });

  it("always returns mp4 as the extension (mp4-only flow)", () => {
    expect(extensionForMimeType("video/mp4;codecs=h264,aac")).toBe("mp4");
    expect(extensionForMimeType("video/webm;codecs=vp9,opus")).toBe("mp4");
    expect(extensionForMimeType(null)).toBe("mp4");
  });

  it("always returns video/mp4 as the response content type", () => {
    expect(contentTypeForVideoFilename("clip.mp4")).toBe("video/mp4");
    expect(contentTypeForVideoFilename("clip.webm")).toBe("video/mp4");
  });

  it("rejects non-mp4 and unsafe video filenames", () => {
    expect(isSafeVideoFilename("roast.mp4")).toBe(true);
    expect(isSafeVideoFilename("roast.webm")).toBe(false);
    expect(isSafeVideoFilename("../roast.mp4")).toBe(false);
    expect(isSafeVideoFilename("nested/roast.mp4")).toBe(false);
    expect(isSafeVideoFilename("notes.txt")).toBe(false);
  });

  it("recommended bitrate targets ~10 MB per ~3-min session", () => {
    expect(recommendedVideoBitsPerSecond(720, 720, 30)).toBeGreaterThanOrEqual(350_000);
    expect(recommendedVideoBitsPerSecond(720, 720, 30)).toBeLessThanOrEqual(700_000);
    expect(recommendedVideoBitsPerSecond(3840, 2160, 60)).toBeLessThanOrEqual(700_000);
    expect(recommendedVideoBitsPerSecond(160, 160, 15)).toBeGreaterThanOrEqual(350_000);
  });
});
