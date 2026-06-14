/**
 * Reading-mode color themes. Day is the default parchment-and-ink look;
 * Sepia is warmer and easier on aging eyes (Nana's frequent ask in
 * grandparent-targeted reading apps); Night is dark for evening sessions
 * so the book doesn't strobe a dark room.
 */

export type ReadingTheme = "day" | "sepia" | "night";

export interface ReadingThemeColors {
  /** Page background — the "paper". */
  page: string;
  /** Spine and ornamental dividers. */
  spine: string;
  /** Body text color. */
  text: string;
  /** Headings, drop caps, ornament borders. */
  accent: string;
  /** Secondary text color (running header / page numbers). */
  muted: string;
  /** Word-highlight overlay color (amber-ish, theme-tinted). */
  highlight: string;
  /** Inset shadow on each page edge near the spine. */
  spineShadow: string;
  /** Outer book shadow (the desk under the open book). */
  bookShadow: string;
}

export const READING_THEMES: Record<ReadingTheme, ReadingThemeColors> = {
  day: {
    page: "#F2E4C4",
    spine: "#5C3A1E",
    text: "#2D1A08",
    accent: "#5C3A1E",
    muted: "#5C3A1E",
    highlight: "rgba(201,146,42,0.55)",
    spineShadow: "rgba(0,0,0,0.13)",
    bookShadow: "0 6px 28px rgba(0,0,0,0.55), 0 1px 4px rgba(0,0,0,0.30)",
  },
  sepia: {
    page: "#EFE0BD",
    spine: "#6B4218",
    text: "#3F2208",
    accent: "#6B4218",
    muted: "#7A5028",
    highlight: "rgba(201,146,42,0.55)",
    spineShadow: "rgba(75,30,5,0.18)",
    bookShadow: "0 6px 28px rgba(60,30,10,0.50), 0 1px 4px rgba(60,30,10,0.30)",
  },
  night: {
    page: "#1B2030",
    spine: "#3A2C18",
    text: "#D8C8A8",
    accent: "#C9922A",
    muted: "rgba(216,200,168,0.55)",
    highlight: "rgba(201,146,42,0.42)",
    spineShadow: "rgba(0,0,0,0.55)",
    bookShadow: "0 8px 32px rgba(0,0,0,0.85), 0 1px 4px rgba(0,0,0,0.5)",
  },
};

export const READING_THEME_LABEL: Record<ReadingTheme, string> = {
  day: "Day",
  sepia: "Sepia",
  night: "Night",
};

export const NEXT_THEME: Record<ReadingTheme, ReadingTheme> = {
  day: "sepia",
  sepia: "night",
  night: "day",
};
