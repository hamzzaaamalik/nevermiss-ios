import type { CSSProperties, ReactNode } from "react";
import { useEffect, useState } from "react";
import { DailyVideo } from "@daily-co/daily-react";
import { Avatar, getRoleLabel } from "./Avatar";
import { AudioLevelMeter } from "./AudioLevelMeter";
import { TileIndicators } from "./TileIndicators";
import { QUALITY_COLOR, QUALITY_LABEL, type VideoPerson } from "./types";
import { useVideoSession } from "./VideoSessionProvider";
import { useCameraOff, useMicMuted, useTrackPlayable, useVideoTile } from "./useVideoTile";

interface FaceVideoProps {
  person: VideoPerson;
  width: number | string;
  height: number | string;
  /** Display label shown over the tile. */
  label?: string;
  showLabel?: boolean;
  borderRadius?: number | string;
  /**
   * Optional static image fallback. If omitted, renders a Google Meet-style
   * avatar circle with the role's initial.
   */
  fallbackSrc?: string;
  objectFit?: "cover" | "contain";
  objectPosition?: string;
  hideQualityDot?: boolean;
  overlay?: ReactNode;
  /** Mirror the local participant's own video horizontally. Default true. */
  autoMirror?: boolean;
  /** Suppress all live indicators (active speaker, mic-off, "you" pill, audio meter). */
  hideIndicators?: boolean;
  /** Compact = 140×88-ish ribbon tile. Smaller badges, tighter spacing. */
  compact?: boolean;
  /**
   * When true, paints an unmistakable "● REC" pill on the tile + a thin
   * red outline. Rick saw the existing pulsing button as ambiguous —
   * this is the explicit "we are recording right now" signal.
   */
  isRecording?: boolean;
  style?: CSSProperties;
}

export function FaceVideo({
  person,
  width,
  height,
  label,
  showLabel = true,
  borderRadius = 12,
  fallbackSrc,
  // CONTAIN by default — Rick: "whatever the screen camera size is, it
  // should show 100% in it not zoom-in version." Contain shows the full
  // source frame with letterboxing/pillarboxing as needed. Tile sizes
  // can be any aspect; the video adapts to its native source aspect
  // inside the tile.
  objectFit = "contain",
  objectPosition = "center 35%",
  hideQualityDot = false,
  overlay,
  autoMirror = true,
  hideIndicators = false,
  compact = false,
  isRecording = false,
  style,
}: FaceVideoProps) {
  const { connectionId, status } = useVideoSession();
  const { participantId, quality, isLocal, isActiveSpeaker } = useVideoTile({ person, connectionId });
  const displayLabel = label ?? getRoleLabel(person);
  const isConnecting = status === "connecting" || status === "reconnecting";

  // 3-second grace window after a participant first joins. While true the
  // quality dot stays neutral gray instead of flickering through
  // red→amber→green as Daily's network stats stabilise (Rick: "Quality
  // indicator dot is not consistently present at the start of sessions").
  const [graceActive, setGraceActive] = useState(false);
  useEffect(() => {
    if (!participantId) return;
    setGraceActive(true);
    const t = window.setTimeout(() => setGraceActive(false), 3000);
    return () => window.clearTimeout(t);
  }, [participantId]);

  const effectiveQuality = graceActive ? "unknown" : quality;
  const color = QUALITY_COLOR[effectiveQuality] ?? "rgba(255,255,255,0.35)";
  // Only show the colored outline when quality is degraded — at "good"
  // (green) or during the grace period it just adds visual noise around
  // the video.
  const showQualityOutline = !graceActive && quality !== "good" && quality !== "unknown";

  // Recording outline takes priority — when the call is being recorded,
  // every other visual decoration is subordinate to "this tile is being
  // recorded right now."
  const tileOutline = isRecording
    ? "2px solid #ef4444"
    : showQualityOutline
      ? `2px solid ${color}`
      : "1px solid rgba(255,255,255,0.08)";

  return (
    <div
      role="img"
      aria-label={`${displayLabel} video tile${isRecording ? " (recording)" : ""}`}
      // Marker for the local-only CSS blur fallback. Used by the
      // `body.nm-blur-self-active [data-nm-local="true"] video` rule
      // when neither Daily's native processor nor our MediaPipe +
      // customTrack pipeline succeed. Remote tiles never carry this
      // attribute, so the rule cannot double-blur an already-segmented
      // stream — that was the regression Rick hit when the older
      // synced-CSS path layered blur on top of Daily's processor.
      data-nm-local={isLocal ? "true" : undefined}
      style={{
        width,
        height,
        borderRadius,
        overflow: "hidden",
        position: "relative",
        flexShrink: 0,
        outline: tileOutline,
        outlineOffset: -1,
        boxShadow: isRecording
          ? "0 4px 18px rgba(0,0,0,0.45), 0 0 0 3px rgba(239,68,68,0.18), inset 0 0 0 1px rgba(255,255,255,0.04)"
          : "0 4px 18px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(255,255,255,0.04)",
        backgroundColor: "#0d1424",
        transition: "outline-color 240ms ease, outline-width 240ms ease, box-shadow 240ms ease",
        ...style,
      }}
    >
      {participantId ? (
        <LiveOrFallback
          participantId={participantId}
          person={person}
          fallbackSrc={fallbackSrc}
          label={displayLabel}
          objectFit={objectFit}
          objectPosition={objectPosition}
          autoMirror={autoMirror}
        />
      ) : (
        <Fallback
          person={person}
          fallbackSrc={fallbackSrc}
          label={displayLabel}
          objectFit={objectFit}
          objectPosition={objectPosition}
        />
      )}

      {isConnecting && !participantId && <ConnectingShimmer />}
      {isConnecting && !participantId && <ConnectingLabel />}

      {!hideIndicators && participantId && (
        <Indicators
          participantId={participantId}
          isLocal={isLocal}
          isActiveSpeaker={isActiveSpeaker}
          compact={compact}
        />
      )}

      {/* Persistent "● REC" pill — appears any time the session is being
          recorded so the indicator is unmistakable regardless of where
          your eyes are. Solid red dot + REC text, gentle 1s blink. */}
      {isRecording && <RecordingBadge compact={compact} />}

      {overlay}

      {showLabel && displayLabel && (
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            background: "linear-gradient(to top, rgba(0,0,0,0.72) 0%, transparent 100%)",
            padding: compact ? "12px 8px 6px" : "16px 10px 8px",
            pointerEvents: "none",
            zIndex: 2,
          }}
        >
          <span
            style={{
              color: "#fff",
              fontFamily: "Inter, DM Sans, sans-serif",
              fontSize: compact ? 10 : 11,
              fontWeight: 600,
              letterSpacing: "0.01em",
              textShadow: "0 1px 2px rgba(0,0,0,0.6)",
            }}
          >
            {displayLabel}
          </span>
        </div>
      )}

      {!hideQualityDot && (
        <div
          aria-label={QUALITY_LABEL[quality]}
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            width: 8,
            height: 8,
            borderRadius: "50%",
            backgroundColor: color,
            boxShadow: `0 0 0 2px rgba(0,0,0,0.45), 0 0 8px ${color}`,
            transition: "background-color 200ms ease",
            zIndex: 4,
          }}
        />
      )}
    </div>
  );
}

/**
 * Wrapper that pulls per-participant state hooks. Split out so they're only
 * called when participantId is non-null (hooks-of-hooks rule).
 */
function Indicators({
  participantId,
  isLocal,
  isActiveSpeaker,
  compact,
}: {
  participantId: string;
  isLocal: boolean;
  isActiveSpeaker: boolean;
  compact: boolean;
}) {
  const micMuted = useMicMuted(participantId);
  const cameraOff = useCameraOff(participantId);

  return (
    <TileIndicators
      isLocal={isLocal}
      isActiveSpeaker={isActiveSpeaker}
      micMuted={micMuted}
      cameraOff={cameraOff}
      compact={compact}
      meter={
        !micMuted ? (
          <AudioLevelMeter
            participantId={participantId}
            bars={3}
            height={compact ? 10 : 14}
            width={compact ? 2 : 3}
          />
        ) : null
      }
    />
  );
}

function LiveOrFallback({
  participantId,
  person,
  fallbackSrc,
  label,
  objectFit,
  objectPosition,
  autoMirror,
}: {
  participantId: string;
  person: VideoPerson;
  fallbackSrc?: string;
  label: string;
  objectFit: "cover" | "contain";
  objectPosition: string;
  autoMirror: boolean;
}) {
  const playable = useTrackPlayable(participantId);

  if (!playable) {
    return (
      <Fallback person={person} fallbackSrc={fallbackSrc} label={label} objectFit={objectFit} objectPosition={objectPosition} />
    );
  }

  // Background-blur is applied at the source by Daily's own processor
  // (see VideoControls.toggleBlur → daily.updateInputSettings). The
  // stream we render here is whatever Daily delivers — blurred when
  // Daily's processor is engaged, raw otherwise. No client-side
  // segmentation: that's the vendor's job and they ship it.
  return (
    <DailyVideo
      sessionId={participantId}
      type="video"
      automirror={autoMirror}
      fit={objectFit}
      style={{
        width: "100%",
        height: "100%",
        objectFit,
        objectPosition,
        display: "block",
      }}
    />
  );
}

function Fallback({
  person,
  fallbackSrc,
  label,
  objectFit,
  objectPosition,
}: {
  person: VideoPerson;
  fallbackSrc?: string;
  label: string;
  objectFit: "cover" | "contain";
  objectPosition: string;
}) {
  if (fallbackSrc) {
    return (
      <img
        src={fallbackSrc}
        alt={label}
        style={{ width: "100%", height: "100%", objectFit, objectPosition, display: "block" }}
      />
    );
  }
  return <Avatar person={person} label={label} />;
}

function RecordingBadge({ compact }: { compact: boolean }) {
  return (
    <div
      role="status"
      aria-label="Recording in progress"
      style={{
        position: "absolute",
        top: compact ? 6 : 10,
        right: compact ? 6 : 10,
        display: "inline-flex",
        alignItems: "center",
        gap: compact ? 4 : 6,
        backgroundColor: "rgba(239,68,68,0.95)",
        color: "white",
        padding: compact ? "3px 7px" : "4px 9px",
        borderRadius: 999,
        fontFamily: "Inter, DM Sans, sans-serif",
        fontSize: compact ? 9 : 11,
        fontWeight: 800,
        letterSpacing: "0.08em",
        boxShadow: "0 4px 14px rgba(0,0,0,0.45)",
        backdropFilter: "blur(6px)",
        zIndex: 5,
        pointerEvents: "none",
      }}
    >
      <span
        aria-hidden
        style={{
          width: compact ? 6 : 8,
          height: compact ? 6 : 8,
          borderRadius: "50%",
          backgroundColor: "white",
          animation: "rec-pulse 1.2s ease-in-out infinite",
          flexShrink: 0,
        }}
      />
      REC
    </div>
  );
}

function ConnectingLabel() {
  return (
    <div
      aria-live="polite"
      style={{
        position: "absolute",
        bottom: 14,
        left: "50%",
        transform: "translateX(-50%)",
        backgroundColor: "rgba(11,23,46,0.78)",
        color: "rgba(255,255,255,0.92)",
        fontFamily: "Inter, DM Sans, sans-serif",
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: "0.04em",
        padding: "6px 12px",
        borderRadius: 999,
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        zIndex: 6,
        backdropFilter: "blur(8px)",
        boxShadow: "0 4px 14px rgba(0,0,0,0.35)",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          backgroundColor: "#22c55e",
          boxShadow: "0 0 8px rgba(34,197,94,0.6)",
          animation: "video-status-dot 1.4s ease-in-out infinite",
        }}
      />
      Connecting video…
    </div>
  );
}

function ConnectingShimmer() {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        background:
          "linear-gradient(110deg, transparent 25%, rgba(255,255,255,0.07) 50%, transparent 75%)",
        backgroundSize: "200% 100%",
        animation: "video-shimmer 1.6s linear infinite",
        pointerEvents: "none",
      }}
    />
  );
}
