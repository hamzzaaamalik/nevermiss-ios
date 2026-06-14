import type { CSSProperties, ReactNode } from "react";
import { MicOff, VideoOff } from "lucide-react";

interface TileIndicatorsProps {
  /** True if this is the local participant's own tile. */
  isLocal: boolean;
  /** True if Daily reports this participant is the active speaker. */
  isActiveSpeaker: boolean;
  /** Mic muted state — drives the mic-off badge. */
  micMuted: boolean;
  /** Camera off state — drives the camera-off badge. */
  cameraOff: boolean;
  /** Compact mode for the 140×88 ribbon tile. */
  compact?: boolean;
  /** Optional extra slot — e.g. an audio-level meter. */
  meter?: ReactNode;
}

/**
 * Overlay layer for FaceVideo that surfaces:
 *   - "You" pill (local only)
 *   - mic-off badge
 *   - camera-off badge
 *   - active-speaker animated ring (remote only)
 *   - audio-level meter slot
 *
 * Designed to be rendered absolutely-positioned inside a FaceVideo tile.
 * The active-speaker ring uses outline-offset to avoid touching the network
 * quality outline already on the tile.
 */
export function TileIndicators({
  isLocal,
  isActiveSpeaker,
  micMuted,
  cameraOff,
  compact = false,
  meter,
}: TileIndicatorsProps) {
  const showSpeakerRing = isActiveSpeaker && !isLocal && !micMuted;

  return (
    <>
      {showSpeakerRing && <ActiveSpeakerRing />}

      {/* "YOU" pill removed — Rick: "People will know which tile is theirs.
          Please remove it to clean up the tile UI." */}
      {false && isLocal && <YouPill compact={compact} />}

      <BadgeStack
        compact={compact}
        items={[
          micMuted && {
            key: "mic",
            icon: <MicOff size={compact ? 11 : 13} strokeWidth={2.4} aria-hidden />,
            label: "Mic muted",
            tone: "#ef4444",
          },
          cameraOff && {
            key: "cam",
            icon: <VideoOff size={compact ? 11 : 13} strokeWidth={2.4} aria-hidden />,
            label: "Camera off",
            tone: "#94a3b8",
          },
        ].filter(Boolean) as Badge[]}
      />

      {meter && (
        <div
          style={{
            position: "absolute",
            right: compact ? 6 : 10,
            bottom: compact ? 6 : 10,
            zIndex: 4,
          }}
        >
          {meter}
        </div>
      )}
    </>
  );
}

interface Badge {
  key: string;
  icon: ReactNode;
  label: string;
  tone: string;
}

function BadgeStack({ items, compact }: { items: Badge[]; compact: boolean }) {
  if (items.length === 0) return null;
  const size = compact ? 20 : 24;
  return (
    <div
      style={{
        position: "absolute",
        left: compact ? 6 : 10,
        top: compact ? 6 : 10,
        display: "flex",
        gap: 4,
        zIndex: 4,
      }}
    >
      {items.map((b) => (
        <span
          key={b.key}
          aria-label={b.label}
          title={b.label}
          style={{
            width: size,
            height: size,
            borderRadius: "50%",
            backgroundColor: "rgba(0,0,0,0.65)",
            color: b.tone,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            backdropFilter: "blur(6px)",
            border: `1px solid ${b.tone}55`,
          }}
        >
          {b.icon}
        </span>
      ))}
    </div>
  );
}

function YouPill({ compact }: { compact: boolean }) {
  const style: CSSProperties = {
    position: "absolute",
    left: compact ? 6 : 10,
    top: compact ? 6 : 10,
    fontSize: compact ? 9 : 10,
    fontWeight: 700,
    letterSpacing: "0.06em",
    color: "#fff",
    backgroundColor: "rgba(0,0,0,0.55)",
    border: "1px solid rgba(255,255,255,0.22)",
    borderRadius: 999,
    padding: compact ? "2px 7px" : "3px 9px",
    fontFamily: "Inter, DM Sans, sans-serif",
    pointerEvents: "none",
    zIndex: 4,
    backdropFilter: "blur(6px)",
  };
  return <span style={style}>YOU</span>;
}

function ActiveSpeakerRing() {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        borderRadius: "inherit",
        outline: "3px solid #22c55e",
        outlineOffset: -3,
        boxShadow: "0 0 0 6px rgba(34,197,94,0.18), inset 0 0 16px rgba(34,197,94,0.18)",
        pointerEvents: "none",
        animation: "video-active-speaker 1.2s ease-in-out infinite",
        zIndex: 3,
      }}
    />
  );
}
