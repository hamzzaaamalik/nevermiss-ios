import type { CSSProperties, ReactNode } from "react";
import { SPACE } from "./tokens";

interface TileGridProps {
  /** Number of columns. Default 2. */
  columns?: number;
  /** Gap between tiles in px. Default SPACE.md = 12. */
  gap?: number;
  /** Optional max-width for the grid container. */
  maxWidth?: number | string;
  /** Center the grid horizontally. Default true. */
  center?: boolean;
  children: ReactNode;
  style?: CSSProperties;
}

/**
 * Layout container for `<TileButton>` rows. Replaces the old
 * `display: flex; gap: 8px;` pill rows with a proper grid so buttons
 * stay aligned even when their labels wrap to two lines.
 */
export function TileGrid({
  columns = 2,
  gap = SPACE.md,
  maxWidth,
  center = true,
  children,
  style,
}: TileGridProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gap,
        maxWidth,
        marginLeft: center ? "auto" : undefined,
        marginRight: center ? "auto" : undefined,
        width: "100%",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
