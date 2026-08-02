import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["ws"],
  // Next 16 blocks dev-resource/HMR requests whose browser origin is not
  // explicitly trusted. The owner's phone reaches this checkout over the
  // private Wi-Fi address; without this entry the HTML renders but React never
  // hydrates, leaving every visible control inert. Development-only and scoped
  // to this machine's current private LAN address.
  allowedDevOrigins: ["10.0.0.36"],
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
