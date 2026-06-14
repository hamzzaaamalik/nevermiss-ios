import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'family.nevermiss.app',
  appName: 'NeverMiss',
  // Vite's `build.outDir` is `dist/public/` (see vite.config.ts), so
  // Capacitor must look there for index.html + the hashed asset bundle.
  // Leaving the default 'dist' caused `npx cap copy ios` to fail with
  // "The web assets directory (.\dist) must contain an index.html file."
  webDir: 'dist/public',
  ios: {
    contentInset: 'always',
    // Allow the embedded WKWebView to mix HTTPS api calls with the
    // local file:// origin where the SPA bundle is served from.
    allowsLinkPreview: false,
  },
};

export default config;
