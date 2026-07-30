import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["ws"],
  env: {
    // A deterministic deploy/build stamp for the discreet developer-UI trigger.
    // An explicit value is useful for reproducible builds; otherwise each build
    // gets the time Next loaded this config.
    NEXT_PUBLIC_BUILD_TIMESTAMP:
      process.env.NEXT_PUBLIC_BUILD_TIMESTAMP ?? new Date().toISOString(),
  },
  webpack: (config) => {
    // Suppress "Critical dependency" warnings from onnxruntime-web (used by @ricky0123/vad-web).
    // The WASM loader uses dynamic require() that webpack can't statically analyze — harmless.
    config.module.exprContextCritical = false;
    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      { module: /onnxruntime-web/ },
    ];
    return config;
  },
};

export default nextConfig;
