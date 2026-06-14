import { useRef, useState } from "react";
import { useAudioLevelObserver } from "@daily-co/daily-react";

interface AudioLevelMeterProps {
  participantId: string;
  /** Bar count. Default 3. */
  bars?: number;
  /** Per-bar height in px. Default 14. */
  height?: number;
  /** Per-bar width in px. Default 3. */
  width?: number;
  color?: string;
  /** Floor below which the meter is considered silent. Default 0.04. */
  floor?: number;
  /** Silence duration before fading the meter out. Default 800ms. */
  silenceMs?: number;
  style?: React.CSSProperties;
}

/**
 * Audio-level visualizer driven by Daily's no-render observer hook. Bar
 * styles update via direct DOM mutation — only the active/inactive boolean
 * triggers a React render, so this is cheap even at 30+ fps.
 *
 * The component fades to opacity 0 after `silenceMs` of quiet so the tile
 * doesn't carry a permanent UI element.
 */
export function AudioLevelMeter({
  participantId,
  bars = 3,
  height = 14,
  width = 3,
  color = "#22c55e",
  floor = 0.04,
  silenceMs = 800,
  style,
}: AudioLevelMeterProps) {
  const [active, setActive] = useState(false);
  const activeRef = useRef(false);
  const lastNonZero = useRef(0);
  const barRefs = useRef<HTMLDivElement[]>([]);

  // Stable callback — closes over refs only, never over `active` state.
  // Uses activeRef so we don't depend on stale closure values when daily-react
  // keeps the same subscription across renders.
  useAudioLevelObserver(participantId, (level) => {
    const clamped = Math.min(1, Math.max(0, level));
    const isLoud = clamped > floor;

    if (isLoud) {
      lastNonZero.current = Date.now();
      if (!activeRef.current) {
        activeRef.current = true;
        setActive(true);
      }
    } else if (activeRef.current && Date.now() - lastNonZero.current > silenceMs) {
      activeRef.current = false;
      setActive(false);
    }

    // Non-linear scaling so quiet talk still moves the bars visibly.
    const scaled = Math.pow(clamped, 0.6);
    const len = barRefs.current.length;
    for (let i = 0; i < len; i++) {
      const el = barRefs.current[i];
      if (!el) continue;
      const offset = len > 1 ? i / (len - 1) : 0.5;
      // Stagger so middle bars pop more than edges, like an EQ.
      const peak = Math.max(0, scaled - Math.abs(offset - 0.5) * 0.35);
      el.style.transform = `scaleY(${0.25 + peak * 0.95})`;
    }
  });

  return (
    <div
      aria-hidden
      style={{
        display: "inline-flex",
        alignItems: "flex-end",
        gap: 2,
        opacity: active ? 1 : 0,
        transition: "opacity 220ms ease",
        pointerEvents: "none",
        ...style,
      }}
    >
      {Array.from({ length: bars }).map((_, i) => (
        <div
          key={i}
          ref={(el) => {
            if (el) barRefs.current[i] = el;
          }}
          style={{
            width,
            height,
            borderRadius: width,
            backgroundColor: color,
            transformOrigin: "bottom center",
            transform: "scaleY(0.25)",
            transition: "transform 60ms linear",
            boxShadow: `0 0 6px ${color}80`,
          }}
        />
      ))}
    </div>
  );
}
