import type { CSSProperties } from "react";
import { useEffect, useState } from "react";

export type ReactionEmoji = "heart" | "star" | "clap" | "smile" | "wow" | "celebrate";

const REACTIONS: Record<ReactionEmoji, { glyph: string; label: string }> = {
  heart: { glyph: "💛", label: "Love" },
  star: { glyph: "🌟", label: "Star" },
  clap: { glyph: "👏", label: "Clap" },
  smile: { glyph: "😊", label: "Smile" },
  wow: { glyph: "✨", label: "Wow" },
  celebrate: { glyph: "🎉", label: "Celebrate" },
};

export const REACTION_KEYS = Object.keys(REACTIONS) as ReactionEmoji[];
export function getReactionGlyph(r: ReactionEmoji): string { return REACTIONS[r].glyph; }
export function getReactionLabel(r: ReactionEmoji): string { return REACTIONS[r].label; }

export interface ReactionEvent {
  emoji: ReactionEmoji;
  ts: number;
  /** "nana" | "child" — sender side, just for analytics/copy. */
  from?: "nana" | "child";
}

interface ReactionOverlayProps {
  /** Latest reaction to render. New value (different ts) triggers a fresh
   *  animation. */
  reaction: ReactionEvent | null;
  style?: CSSProperties;
}

/**
 * Full-screen overlay that animates a burst of emoji glyphs floating
 * upward when a reaction arrives. Industry pattern: Zoom / FaceTime / Meet
 * all use this gesture for non-interruptive emotional feedback during a call.
 */
export function ReactionOverlay({ reaction, style }: ReactionOverlayProps) {
  const [particles, setParticles] = useState<Array<{ id: number; emoji: string; left: string; delay: number }>>([]);

  useEffect(() => {
    if (!reaction) return;
    const glyph = getReactionGlyph(reaction.emoji);
    // Burst of 6 glyphs spread horizontally so it feels like a wave, not a single emoji.
    const next = Array.from({ length: 6 }, (_, i) => ({
      id: reaction.ts + i,
      emoji: glyph,
      left: `${15 + i * 13 + (Math.random() * 6 - 3)}%`,
      delay: i * 90,
    }));
    setParticles(next);
    // Clear particles after the longest animation completes.
    const t = setTimeout(() => setParticles([]), 2300);
    return () => clearTimeout(t);
  }, [reaction?.ts]);

  if (particles.length === 0) return null;

  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 60,
        overflow: "hidden",
        ...style,
      }}
    >
      {particles.map((p) => (
        <span
          key={p.id}
          style={{
            position: "absolute",
            bottom: -40,
            left: p.left,
            fontSize: 56,
            animation: `reaction-float 2s cubic-bezier(0.22, 0.6, 0.35, 1) ${p.delay}ms forwards`,
            filter: "drop-shadow(0 4px 12px rgba(0,0,0,0.45))",
            userSelect: "none",
          }}
        >
          {p.emoji}
        </span>
      ))}
    </div>
  );
}
