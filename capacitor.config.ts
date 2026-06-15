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
  // Enable CapacitorHttp: intercepts every fetch()/XMLHttpRequest call
  // from the SPA and runs it through native iOS NSURLSession instead
  // of the WKWebView. That gives us:
  //   - a native cookie jar (NSHTTPCookieStorage) that survives ITP
  //   - cross-origin requests without WebView CORS preflight
  //   - persistent sessions across app restarts
  // This is the fix for the "load failed" + "Not authenticated" issue
  // we hit on Build #1: cookies set by api.nevermiss.family weren't
  // being attached to subsequent WebView fetch() calls because iOS ITP
  // treats them as third-party. With CapacitorHttp on, the SPA's
  // fetch() calls happen at the native layer where cookies just work.
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
