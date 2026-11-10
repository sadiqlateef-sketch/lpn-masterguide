import type { CapacitorConfig } from "@capacitor/cli";

// Android app shell. The screens are bundled from `out/` (MOBILE_BUILD=1 next build) and call the
// hosted API at NEXT_PUBLIC_API_BASE_URL. Set CAP_LIVE_URL (e.g. http://192.168.1.20:3000) to point
// the app at a dev server on your network for live reload instead.
const liveUrl = process.env.CAP_LIVE_URL;

const config: CapacitorConfig = {
  appId: "com.lpnmasterguide.app",
  appName: "LPN MasterGuide",
  webDir: "out",
  backgroundColor: "#020617",
  server: {
    androidScheme: "https",
    ...(liveUrl ? { url: liveUrl, cleartext: liveUrl.startsWith("http://") } : {}),
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: process.env.CAP_DEBUG === "1",
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: "#020617",
      showSpinner: false,
      androidScaleType: "CENTER_CROP",
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#020617",
      overlaysWebView: false,
    },
  },
};

export default config;
