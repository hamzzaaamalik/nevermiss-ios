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
    allowsLinkPreview: false,
  },
  // Pin the in-app WebView's origin to a real subdomain of
  // nevermiss.family. Default would be `capacitor://localhost`, which
  // is cross-SITE to `api.nevermiss.family` — iOS WKWebView's ITP then
  // blocks the auth session cookie (set with Domain=.nevermiss.family)
  // because it counts as third-party. With this hostname, the WebView
  // is `https://app.nevermiss.family`, same-site as api.*, so cookies
  // flow naturally and the existing SameSite=Lax server config Just
  // Works. No DNS record is required — the WebView resolves the
  // hostname locally via WKURLSchemeHandler; it never hits the network.
  server: {
    iosScheme: 'https',
    hostname: 'app.nevermiss.family',
  },
};

export default config;
