export const MAX_API_JSON_BYTES = 2_500_000;
export const MAX_IMAGE_BASE64_CHARS = 2_000_000;

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 413,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}
/** Parse JSON with a real byte ceiling even when Content-Length is absent. */
export async function readLimitedJson<T>(
  req: Request,
  maxBytes = MAX_API_JSON_BYTES,
): Promise<T> {
  const declaredLength = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ApiRequestError("Payload too large", 413);
  }

  const reader = req.body?.getReader();
  if (!reader) {
    throw new ApiRequestError("Invalid JSON", 400);
  }

  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ApiRequestError("Payload too large", 413);
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
  } finally {
    reader.releaseLock();
  }

  const raw = chunks.join("");
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ApiRequestError("JSON object required", 400);
    }
    return parsed as T;
  } catch (error) {
    if (error instanceof ApiRequestError) throw error;
    throw new ApiRequestError("Invalid JSON", 400);
  }
}

export function isValidImageBase64(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_IMAGE_BASE64_CHARS
  );
}
