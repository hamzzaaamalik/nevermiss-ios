/**
 * NeverMiss design tokens — every magic number lives here, nowhere else.
 * Replaces ~200 inline padding/font/shadow constants scattered across
 * App.tsx with a single source of truth. Keeps the visual language
 * coherent and makes a future redesign a one-file change.
 */

export const COLOR = {
  // Brand
  navy: "#1B2B4B",
  navyDeep: "#0b172e",
  amber: "#C9922A",
  amberSoft: "rgba(201,146,42,0.14)",
  cream: "#F7F0E3",
  parchment: "#F2E4C4",
  leather: "#5C3A1E",
  bookText: "#2D1A08",

  // Surfaces
  surface: "rgba(255,255,255,0.04)",
  surfaceHover: "rgba(255,255,255,0.07)",
  border: "rgba(255,255,255,0.10)",
  borderStrong: "rgba(255,255,255,0.18)",

  // Text
  text: "#F7F0E3",
  textMuted: "rgba(247,240,227,0.66)",
  textDim: "rgba(247,240,227,0.42)",

  // Status
  good: "#22c55e",
  warn: "#eab308",
  bad: "#ef4444",
  info: "#60a5fa",
} as const;

export const SPACE = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const RADIUS = {
  xs: 6,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;

export const FONT = {
  // Sizes — minimum readable on iPad is 11px.
  xs: 11,
  sm: 12,
  md: 14,
  lg: 16,
  xl: 18,
  xxl: 22,
  display: 28,
  hero: 36,

  // Weights
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  heavy: 800,
  black: 900,

  // Families
  sans: "Inter, DM Sans, sans-serif",
  serif: "Merriweather, serif",
  display_family: "Playfair Display, serif",
} as const;

export const SHADOW = {
  xs: "0 1px 2px rgba(0,0,0,0.20)",
  sm: "0 2px 8px rgba(0,0,0,0.30)",
  md: "0 4px 18px rgba(0,0,0,0.45)",
  lg: "0 12px 40px rgba(0,0,0,0.55)",
  inset: "inset 0 0 0 1px rgba(255,255,255,0.04)",
} as const;

/**
 * Z-index hierarchy. Every overlay used to be at z=20 — now overlays
 * have explicit semantic layers so they stack predictably.
 */
export const Z = {
  base: 0,
  surface: 5,
  overlay: 20,
  pointer: 30,
  reconnect: 100,
  modal: 200,
  toast: 1000,
  debug: 9999,
} as const;

/** Common easing curves. */
export const EASE = {
  /** Apple-style snappy. Use for page transitions, mode switches. */
  snap: "cubic-bezier(0.32, 0.72, 0, 1)",
  /** Material-style soft. Use for hover/press effects. */
  soft: "cubic-bezier(0.4, 0, 0.2, 1)",
  /** Smooth in/out — good for fades. */
  inOut: "cubic-bezier(0.45, 0, 0.55, 1)",
} as const;

/** Animation durations in ms. */
export const DUR = {
  fast: 120,
  mid: 200,
  slow: 300,
  page: 500,
} as const;

/** Apple HIG / WCAG minimum interactive size — never smaller than 44pt. */
export const HIT_TARGET = 44;

/**
 * Tile-button sizes. Rick wanted primary actions "closer to square or
 * tall rectangles — something like the size of the video thumbnails"
 * because long thin pills are hard to tap accurately with a finger on
 * iPad. These three sizes give us a coherent vocabulary across every
 * screen — sm for inline rows, md for primary actions, lg for hero CTAs.
 */
export const TILE = {
  sm: 80,
  md: 96,
  lg: 120,
} as const;

/** Common transition strings. */
export const TRANSITION = {
  base: `all ${DUR.fast}ms ${EASE.soft}`,
  hover: `background-color ${DUR.fast}ms ${EASE.soft}, border-color ${DUR.fast}ms ${EASE.soft}, transform ${DUR.fast}ms ${EASE.soft}, color ${DUR.fast}ms ${EASE.soft}`,
} as const;
