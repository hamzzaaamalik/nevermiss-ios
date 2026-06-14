import type { CSSProperties } from "react";
import type { VideoPerson } from "./types";

interface AvatarProps {
  person: VideoPerson;
  /** Display label whose first character drives the initial. */
  label?: string;
  /** Sizing of the rendered avatar. */
  size?: number | "fill";
  /** Extra style overrides. */
  style?: CSSProperties;
}

const PALETTE: Record<VideoPerson, { bg: string; fg: string }> = {
  nana: { bg: "#A66B2E", fg: "#FFF8EC" },     // warm amber-clay
  child: { bg: "#3B5BDB", fg: "#EAF0FF" },    // indigo (Google Meet feel)
};

// Generic role-label fallbacks. These leak into many user-facing strings
// via `getRoleLabel("child")` when no actual name is resolved (pre-PIN,
// pre-connection, missing dashboardPerryName, etc.). Rick: "grandchild
// name can be anyone... don't hardcode perry name." Using "Grandchild"
// here is the single source of truth that every fallback now picks up.
const ROLE_LABEL: Record<VideoPerson, string> = {
  nana: "Nana",
  child: "Grandchild",
};

// First-letter fallback when no name has been resolved yet. Distinct per
// role so the avatars stay visually distinguishable in the no-name state.
const ROLE_INITIAL: Record<VideoPerson, string> = {
  nana: "N",
  child: "G",
};

/**
 * Google Meet-style fallback avatar. Renders a colored circle with the
 * label's first initial. Used when the participant has no playable video
 * (not joined yet, camera off, audio-only mode).
 */
export function Avatar({ person, label, size = "fill", style }: AvatarProps) {
  const { bg, fg } = PALETTE[person];
  const text = (label ?? "").trim();
  const initial = text ? text[0].toUpperCase() : ROLE_INITIAL[person];

  const isFill = size === "fill";
  const dim = isFill ? "100%" : `${size}px`;

  // Initial takes ~45% of the smaller dimension.
  const fontSize = isFill ? "min(45cqi, 45cqb)" : `${Math.round(Number(size) * 0.45)}px`;

  return (
    <div
      role="img"
      aria-label={`${ROLE_LABEL[person]} avatar`}
      style={{
        width: dim,
        height: dim,
        backgroundColor: bg,
        color: fg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "Inter, DM Sans, sans-serif",
        fontWeight: 600,
        letterSpacing: "-0.02em",
        userSelect: "none",
        containerType: "size",
        ...style,
      }}
    >
      <span style={{ fontSize, lineHeight: 1 }}>{initial}</span>
    </div>
  );
}

export function getRoleLabel(person: VideoPerson): string {
  return ROLE_LABEL[person];
}
