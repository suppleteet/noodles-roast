import { describe, expect, it } from "vitest";
import { isValidImageBase64, readLimitedJson } from "@/lib/apiRequest";

describe("API request validation", () => {
  it("parses a bounded JSON object", async () => {
    const request = new Request("http://localhost/test", {
      method: "POST",
      body: JSON.stringify({ ok: true }),
    });

    await expect(readLimitedJson<{ ok: boolean }>(request, 100)).resolves.toEqual({
      ok: true,
    });
  });

  it("rejects oversized bodies even without Content-Length", async () => {
    const request = new Request("http://localhost/test", {
      method: "POST",
      body: JSON.stringify({ text: "x".repeat(100) }),
    });
    request.headers.delete("content-length");

    await expect(readLimitedJson(request, 20)).rejects.toMatchObject({ status: 413 });
  });

  it("bounds webcam image payloads", () => {
    expect(isValidImageBase64("abc")).toBe(true);
    expect(isValidImageBase64("")).toBe(false);
    expect(isValidImageBase64(123)).toBe(false);
  });
});
