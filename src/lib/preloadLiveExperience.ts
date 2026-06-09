export function preloadLiveExperienceModules(): void {
  void import("@/lib/greetingPrefetch");
  void import("@/components/puppet/PuppetScene");
  void import("@/components/session/LiveSessionController");
  void import("@/components/session/SessionController");
  void import("@/components/ui/ShareScreen");
}

export function preloadVadRuntime(): void {
  void import("@ricky0123/vad-web").catch(() => {});
  fetch("/silero_vad_v5.onnx", { cache: "force-cache" }).catch(() => {});
  fetch("/ort-wasm-simd-threaded.wasm", { cache: "force-cache" }).catch(() => {});
}
