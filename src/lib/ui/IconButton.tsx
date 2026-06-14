import type { ButtonHTMLAttributes, ReactNode } from "react";
import { COLOR, FONT, HIT_TARGET, RADIUS, TRANSITION } from "./tokens";

type Tone = "default" | "amber" | "danger" | "good";
type Size = "sm" | "md" | "lg";

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "size"> {
  /** Lucide icon element. */
  icon: ReactNode;
  /** Required — for screen readers and tooltips. */
  label: string;
  tone?: Tone;
  size?: Size;
  /** Renders the active/pressed state. */
  active?: boolean;
}

const SIZE: Record<Size, number> = {
  sm: 32,
  md: HIT_TARGET, // 44 — Apple HIG min
  lg: 52,
};

const TONE: Record<Tone, { bg: string; bgActive: string; bgHover: string; fg: string; fgActive: string; border: string }> = {
  default: {
    bg: "rgba(255,255,255,0.06)",
    bgHover: "rgba(255,255,255,0.11)",
    bgActive: "rgba(201,146,42,0.22)",
    fg: COLOR.textMuted,
    fgActive: COLOR.amber,
    border: "1px solid rgba(255,255,255,0.10)",
  },
  amber: {
    bg: "rgba(201,146,42,0.14)",
    bgHover: "rgba(201,146,42,0.22)",
    bgActive: "rgba(201,146,42,0.30)",
    fg: COLOR.amber,
    fgActive: COLOR.amber,
    border: "1px solid rgba(201,146,42,0.45)",
  },
  danger: {
    bg: "rgba(239,68,68,0.14)",
    bgHover: "rgba(239,68,68,0.22)",
    bgActive: "rgba(239,68,68,0.30)",
    fg: COLOR.bad,
    fgActive: "#fff",
    border: "1px solid rgba(239,68,68,0.45)",
  },
  good: {
    bg: "rgba(34,197,94,0.14)",
    bgHover: "rgba(34,197,94,0.22)",
    bgActive: "rgba(34,197,94,0.30)",
    fg: COLOR.good,
    fgActive: COLOR.good,
    border: "1px solid rgba(34,197,94,0.45)",
  },
};

/**
 * Round / square icon-only button. Always meets Apple's 44pt min tap target
 * at default size. Use for header chrome, control bars, and floating actions.
 */
export function IconButton({
  icon,
  label,
  tone = "default",
  size = "md",
  active = false,
  disabled,
  style,
  ...rest
}: IconButtonProps) {
  const dim = SIZE[size];
  const palette = TONE[tone];

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      style={{
        width: dim,
        height: dim,
        borderRadius: RADIUS.pill,
        backgroundColor: active ? palette.bgActive : palette.bg,
        border: palette.border,
        color: active ? palette.fgActive : palette.fg,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        transition: TRANSITION.hover,
        fontFamily: FONT.sans,
        padding: 0,
        flexShrink: 0,
        WebkitTapHighlightColor: "transparent",
        ...style,
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        e.currentTarget.style.backgroundColor = active ? palette.bgActive : palette.bgHover;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = active ? palette.bgActive : palette.bg;
      }}
      onMouseDown={(e) => {
        if (disabled) return;
        e.currentTarget.style.transform = "scale(0.94)";
      }}
      onMouseUp={(e) => {
        if (disabled) return;
        e.currentTarget.style.transform = "scale(1)";
      }}
      {...rest}
    >
      {icon}
    </button>
  );
}
