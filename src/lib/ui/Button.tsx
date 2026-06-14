import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { COLOR, EASE, FONT, HIT_TARGET, RADIUS, SPACE, TRANSITION } from "./tokens";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "size"> {
  variant?: Variant;
  size?: Size;
  /** Optional leading icon (lucide-react element). */
  leftIcon?: ReactNode;
  /** Optional trailing icon. */
  rightIcon?: ReactNode;
  /** Stretch to full container width. */
  full?: boolean;
  /** Renders an active loading state (spinner replaces leftIcon, label dims). */
  loading?: boolean;
}

/**
 * Single source of truth for buttons.
 *
 * - `primary`   — amber filled, the main CTA. Max one per screen.
 * - `secondary` — outline, paired with primary or used solo for neutral actions.
 * - `ghost`     — text-only, lowest emphasis.
 * - `danger`    — red filled, destructive actions (end call, etc.).
 *
 * Sizes follow Apple HIG: `sm`=36, `md`=44, `lg`=52. `md` is the default
 * because anything below 44pt fails Apple's tap-target guidance.
 */
export function Button({
  variant = "primary",
  size = "md",
  leftIcon,
  rightIcon,
  full = false,
  loading = false,
  disabled,
  children,
  style,
  ...rest
}: ButtonProps) {
  const dims = SIZE[size];
  const palette = PALETTE[variant];

  const merged: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: SPACE.sm,
    fontFamily: FONT.sans,
    fontWeight: FONT.bold,
    fontSize: dims.fontSize,
    height: dims.height,
    minWidth: dims.height, // ensures icon-only buttons stay square
    padding: `0 ${dims.padX}px`,
    borderRadius: RADIUS.md,
    border: palette.border,
    backgroundColor: palette.bg,
    color: palette.fg,
    cursor: disabled || loading ? "not-allowed" : "pointer",
    opacity: disabled ? 0.45 : 1,
    transition: TRANSITION.hover,
    width: full ? "100%" : undefined,
    letterSpacing: 0,
    boxShadow: palette.shadow,
    userSelect: "none",
    WebkitTapHighlightColor: "transparent",
    ...style,
  };

  return (
    <button
      type="button"
      disabled={disabled || loading}
      style={merged}
      onMouseEnter={(e) => {
        if (disabled || loading) return;
        const el = e.currentTarget;
        el.style.backgroundColor = palette.bgHover;
        if (palette.borderHover) el.style.border = palette.borderHover;
        el.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget;
        el.style.backgroundColor = palette.bg;
        el.style.border = palette.border;
        el.style.transform = "translateY(0)";
      }}
      onMouseDown={(e) => {
        if (disabled || loading) return;
        e.currentTarget.style.transform = "translateY(0) scale(0.97)";
      }}
      onMouseUp={(e) => {
        if (disabled || loading) return;
        e.currentTarget.style.transform = "translateY(-1px) scale(1)";
      }}
      {...rest}
    >
      {loading ? <Spinner size={dims.iconSize} color={palette.fg} /> : leftIcon}
      <span style={{ opacity: loading ? 0.7 : 1 }}>{children}</span>
      {rightIcon}
    </button>
  );
}

const SIZE: Record<Size, { height: number; padX: number; fontSize: number; iconSize: number }> = {
  sm: { height: 36, padX: SPACE.md, fontSize: FONT.xs, iconSize: 14 },
  md: { height: HIT_TARGET, padX: SPACE.lg, fontSize: FONT.sm, iconSize: 16 },
  lg: { height: 52, padX: SPACE.xl, fontSize: FONT.md, iconSize: 18 },
};

interface Palette {
  bg: string;
  bgHover: string;
  fg: string;
  border: string;
  borderHover?: string;
  shadow: string;
}

const PALETTE: Record<Variant, Palette> = {
  primary: {
    bg: COLOR.amber,
    bgHover: "#D9A23F",
    fg: COLOR.navyDeep,
    border: "1px solid transparent",
    shadow: "0 3px 14px rgba(201,146,42,0.40)",
  },
  secondary: {
    bg: "rgba(255,255,255,0.06)",
    bgHover: "rgba(255,255,255,0.11)",
    fg: COLOR.cream,
    border: "1px solid rgba(255,255,255,0.18)",
    borderHover: "1px solid rgba(255,255,255,0.30)",
    shadow: "none",
  },
  ghost: {
    bg: "transparent",
    bgHover: "rgba(255,255,255,0.06)",
    fg: COLOR.textMuted,
    border: "1px solid transparent",
    shadow: "none",
  },
  danger: {
    bg: COLOR.bad,
    bgHover: "#dc2626",
    fg: "#fff",
    border: "1px solid transparent",
    shadow: "0 3px 14px rgba(239,68,68,0.40)",
  },
};

function Spinner({ size, color }: { size: number; color: string }) {
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        border: `2px solid ${color}55`,
        borderTopColor: color,
        animation: `spin 0.8s linear infinite`,
        display: "inline-block",
      }}
    />
  );
}
