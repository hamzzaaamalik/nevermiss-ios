import type { CSSProperties, ReactNode } from "react";
import { COLOR, FONT, RADIUS, SHADOW, TILE, TRANSITION } from "./tokens";

export type TileTone = "primary" | "secondary" | "ghost" | "danger" | "purple" | "info" | "success";
export type TileSize = "sm" | "md" | "lg";
export type TileShape = "square" | "portrait";

interface TileButtonProps {
  /** Top-of-tile glyph — emoji or any ReactNode (e.g. lucide icon). */
  icon?: ReactNode;
  /** Primary one-word or short label, line 1. */
  label: string;
  /** Optional second line for longer labels. */
  sublabel?: string;
  tone?: TileTone;
  /** sm = 80, md = 96, lg = 120. Default md. */
  size?: TileSize;
  /** square = N×N, portrait = N×(N*1.33). Default square. */
  shape?: TileShape;
  onClick?: () => void;
  disabled?: boolean;
  /** Visual highlight when this is the currently-selected option (e.g. silly-faces filter). */
  active?: boolean;
  /** ARIA label override — defaults to `${label} ${sublabel ?? ""}`. */
  ariaLabel?: string;
  /** Optional override style (rare — mostly for full-width grid items). */
  style?: CSSProperties;
}

const TONES: Record<TileTone, { bg: string; bgActive: string; text: string; border: string; shadow: string }> = {
  primary: {
    bg: COLOR.amber,
    bgActive: "color-mix(in srgb, #C9922A 88%, black 12%)",
    text: COLOR.navy,
    border: "transparent",
    shadow: "0 6px 20px rgba(201,146,42,0.42)",
  },
  secondary: {
    bg: "rgba(255,255,255,0.06)",
    bgActive: "rgba(255,255,255,0.12)",
    text: COLOR.cream,
    border: "rgba(255,255,255,0.18)",
    shadow: SHADOW.sm,
  },
  ghost: {
    bg: "transparent",
    bgActive: "rgba(255,255,255,0.06)",
    text: COLOR.textMuted,
    border: "rgba(255,255,255,0.10)",
    shadow: "none",
  },
  danger: {
    bg: "#ef4444",
    bgActive: "#dc2626",
    text: "white",
    border: "transparent",
    shadow: "0 6px 20px rgba(239,68,68,0.40)",
  },
  purple: {
    bg: "rgba(168,85,247,0.18)",
    bgActive: "rgba(168,85,247,0.30)",
    text: "#c084fc",
    border: "#c084fc",
    shadow: "0 4px 14px rgba(168,85,247,0.28)",
  },
  info: {
    bg: "rgba(96,165,250,0.18)",
    bgActive: "rgba(96,165,250,0.30)",
    text: "#60a5fa",
    border: "rgba(96,165,250,0.55)",
    shadow: "0 4px 14px rgba(96,165,250,0.20)",
  },
  success: {
    bg: "rgba(34,197,94,0.18)",
    bgActive: "rgba(34,197,94,0.30)",
    text: "#22c55e",
    border: "#22c55e",
    shadow: "0 4px 14px rgba(34,197,94,0.22)",
  },
};

/**
 * Square / portrait button shaped like a video thumbnail. Replaces the
 * long-thin pill buttons that were hard to tap accurately on iPad with
 * a finger (Rick: "buttons that are closer to square or tall
 * rectangles — something like the size of the video thumbnails").
 *
 * Use for primary screen actions (Start Reading, Save Memory, Start
 * Countdown, etc.). Keep regular `<Button>` pills for secondary actions
 * where the width is intentional (calendar add-buttons, links).
 */
export function TileButton({
  icon,
  label,
  sublabel,
  tone = "primary",
  size = "md",
  shape = "square",
  onClick,
  disabled = false,
  active = false,
  ariaLabel,
  style,
}: TileButtonProps) {
  const px = TILE[size];
  const height = shape === "portrait" ? Math.round(px * 1.33) : px;
  const palette = TONES[tone];
  const fontSize = size === "lg" ? FONT.md : size === "md" ? FONT.sm : FONT.xs + 1;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel ?? `${label}${sublabel ? " " + sublabel : ""}`}
      aria-pressed={active || undefined}
      style={{
        minWidth: px,
        minHeight: height,
        backgroundColor: active ? palette.bgActive : palette.bg,
        color: palette.text,
        border: `1px solid ${active ? palette.text : palette.border}`,
        borderRadius: RADIUS.lg + 2,
        padding: size === "lg" ? "14px 12px" : "10px 8px",
        fontFamily: FONT.sans,
        fontWeight: FONT.heavy,
        fontSize,
        letterSpacing: "0.01em",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: size === "lg" ? 8 : 4,
        boxShadow: active ? palette.shadow : disabled ? "none" : palette.shadow,
        transition: TRANSITION.hover,
        textAlign: "center",
        lineHeight: 1.2,
        // iPad finger-tap UX bits.
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
        ...style,
      }}
    >
      {icon !== undefined && icon !== null && (
        <span
          aria-hidden
          style={{
            fontSize: size === "lg" ? 32 : size === "md" ? 26 : 20,
            lineHeight: 1,
          }}
        >
          {icon}
        </span>
      )}
      <span style={{ display: "block" }}>{label}</span>
      {sublabel && (
        <span
          style={{
            display: "block",
            fontWeight: FONT.semibold,
            fontSize: fontSize - 1,
            opacity: 0.8,
          }}
        >
          {sublabel}
        </span>
      )}
    </button>
  );
}
