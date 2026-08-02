interface MediaCaptureEnvironment {
  isSecureContext: boolean;
  hasGetUserMedia: boolean;
  origin: string;
}

export function mediaCaptureBlockMessage({
  isSecureContext,
  hasGetUserMedia,
  origin,
}: MediaCaptureEnvironment): string | null {
  if (!isSecureContext) {
    return `Camera and microphone are blocked on ${origin} because mobile browsers require HTTPS. Use the HTTPS Vercel preview, or add this LAN origin under chrome://flags/#unsafely-treat-insecure-origin-as-secure and relaunch Chrome.`;
  }

  if (!hasGetUserMedia) {
    return "This browser does not expose camera and microphone capture. Open Roastie in Chrome, Edge, or Safari and allow camera and microphone access.";
  }

  return null;
}

export function currentMediaCaptureBlockMessage(): string | null {
  if (typeof window === "undefined") return null;

  return mediaCaptureBlockMessage({
    isSecureContext: window.isSecureContext,
    hasGetUserMedia: typeof window.navigator.mediaDevices?.getUserMedia === "function",
    origin: window.location.origin,
  });
}
