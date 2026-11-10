import type { NextConfig } from "next";

// MOBILE_BUILD=1 builds the static screens that ship inside the Android app (npm run mobile:build).
// Only .tsx/.jsx files count as pages in that build, so the API route handlers (route.ts) and the
// middleware stay out of it: they keep running on the hosted web app, which the phone calls.
const mobile = process.env.MOBILE_BUILD === "1";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: { unoptimized: true },
  // The exported screens land in out/ (Capacitor's webDir). Next still uses .next for its working
  // files, so run `npm run build` again before `npm start` after a phone build.
  ...(mobile ? { output: "export", distDir: "out", pageExtensions: ["tsx", "jsx"], trailingSlash: true } : {}),
};

export default nextConfig;
