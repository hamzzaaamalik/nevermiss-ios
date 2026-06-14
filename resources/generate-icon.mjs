// One-off icon generator. Produces resources/icon.png (1024x1024) +
// resources/splash.png (2732x2732) using the NeverMiss brand palette.
//
// Run from the nevermiss folder:
//   node resources/generate-icon.mjs
//
// Both files are placeholders — geometric mark with the open-book shape
// the app uses internally. Swap in a designer asset by overwriting these
// two PNGs (same paths, same sizes), then re-run `npx capacitor-assets
// generate --ios` to push them into the Xcode project.

// Sharp is a transitive dep (via @capacitor/assets) and pnpm doesn't
// hoist it into nevermiss/node_modules — resolve the full path so the
// script always finds it regardless of where it's run from.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const sharpPath = require.resolve("sharp", {
  paths: [
    path.resolve(fileURLToPath(import.meta.url), "../../node_modules/@capacitor/assets"),
    path.resolve(fileURLToPath(import.meta.url), "../../../node_modules/.pnpm"),
  ],
});
const sharp = require(sharpPath);

const here = path.dirname(fileURLToPath(import.meta.url));

// Brand palette (matches src/App.tsx COLOR tokens).
const NAVY  = "#14223e";
const AMBER = "#C9922A";
const CREAM = "#F7F0E3";

// Square SVG of size N. Geometric open-book mark on a navy field.
// The mark is generous enough to read at the 60x60 home-screen size while
// still being recognizable at 1024.
function bookMark(size) {
  // Coordinates inside a 1024x1024 viewBox, scaled to whatever `size` is.
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${size}" height="${size}" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="amberGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%"  stop-color="#E0AB4B" />
      <stop offset="100%" stop-color="${AMBER}" />
    </linearGradient>
    <linearGradient id="navyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%"  stop-color="#1B2B4B" />
      <stop offset="100%" stop-color="${NAVY}" />
    </linearGradient>
  </defs>
  <!-- Solid navy background — Apple adds rounded corners automatically. -->
  <rect width="1024" height="1024" fill="url(#navyGrad)" />
  <!-- Open book — same silhouette as the Memory Vault tile. -->
  <g transform="translate(192,260)">
    <!-- Left page -->
    <path d="M 0 90 Q 60 30 200 30 Q 280 30 320 80 L 320 540 Q 280 480 200 480 Q 60 480 0 540 Z"
          fill="url(#amberGrad)"
          stroke="${CREAM}" stroke-width="6" stroke-linejoin="round" />
    <!-- Right page -->
    <path d="M 640 90 Q 580 30 440 30 Q 360 30 320 80 L 320 540 Q 360 480 440 480 Q 580 480 640 540 Z"
          fill="url(#amberGrad)"
          stroke="${CREAM}" stroke-width="6" stroke-linejoin="round"
          opacity="0.93" />
    <!-- Page lines (left) -->
    <line x1="60"  y1="170" x2="280" y2="170" stroke="${CREAM}" stroke-width="10" stroke-linecap="round" opacity="0.78" />
    <line x1="60"  y1="240" x2="260" y2="240" stroke="${CREAM}" stroke-width="10" stroke-linecap="round" opacity="0.65" />
    <line x1="60"  y1="310" x2="270" y2="310" stroke="${CREAM}" stroke-width="10" stroke-linecap="round" opacity="0.55" />
    <!-- Page lines (right) -->
    <line x1="360" y1="170" x2="580" y2="170" stroke="${CREAM}" stroke-width="10" stroke-linecap="round" opacity="0.78" />
    <line x1="380" y1="240" x2="580" y2="240" stroke="${CREAM}" stroke-width="10" stroke-linecap="round" opacity="0.65" />
    <line x1="370" y1="310" x2="580" y2="310" stroke="${CREAM}" stroke-width="10" stroke-linecap="round" opacity="0.55" />
    <!-- Heart at the spine — the "memory" mark. -->
    <path d="M 320 440 l -28 -22 a 18 18 0 1 1 28 -20 a 18 18 0 1 1 28 20 z"
          fill="${CREAM}" />
  </g>
  <!-- Sparkle accent -->
  <path d="M 820 200 l 14 -28 l 14 28 l 28 14 l -28 14 l -14 28 l -14 -28 l -28 -14 z"
        fill="${CREAM}" opacity="0.85" />
</svg>`;
}

async function build() {
  const iconPath = path.join(here, "icon.png");
  const splashPath = path.join(here, "splash.png");

  // Icon — 1024x1024 PNG, no alpha (App Store rejects transparent icons).
  await sharp(Buffer.from(bookMark(1024)))
    .png()
    .flatten({ background: NAVY })
    .toFile(iconPath);

  // Splash / launch screen background — 2732x2732 (covers every iPad).
  // The Capacitor assets tool centers the icon mark on it automatically;
  // we just need a solid navy field at the max size.
  await sharp({
    create: {
      width: 2732,
      height: 2732,
      channels: 4,
      background: NAVY,
    },
  })
    .png()
    .toFile(splashPath);

  console.log("[generate-icon] wrote", iconPath);
  console.log("[generate-icon] wrote", splashPath);
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
