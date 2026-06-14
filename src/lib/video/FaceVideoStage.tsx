import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";
import { FaceVideo } from "./FaceVideo";
import { QUALITY_COLOR } from "./types";
import { useVideoSession } from "./VideoSessionProvider";
import { useVideoTile } from "./useVideoTile";
import type { VideoPerson } from "./types";

interface FaceVideoStageProps {
  /** The person rendered as the big background tile. */
  bigPerson: VideoPerson;
  /** The person rendered in the picture-in-picture corner. */
  pipPerson: VideoPerson;

  /** Optional static image fallback — defaults to a Google Meet-style avatar. */
  bigFallback?: string;
  pipFallback?: string;

  bigName?: string;
  /** Display label for the PiP (used by the fallback avatar's initial). */
  pipName?: string;
  /** Object-fit for the big video; defaults to "cover". */
  bigObjectFit?: "cover" | "contain";
  /** Object-position for the big video. */
  bigObjectPosition?: string;
  /** Object-position for the PiP. */
  pipObjectPosition?: string;

  /** Optional gradient overlay over the big video for legibility. */
  showGradient?: boolean;

  /** Slot for AR / silly-faces filter overlays on the big video. */
  bigOverlay?: ReactNode;
  /** Slot for filter overlays on the PiP. */
  pipOverlay?: ReactNode;

  /** Children rendered above the big video (countdown, animations, etc.). */
  children?: ReactNode;

  /** PiP size + position. */
  pipWidth?: number;
  pipHeight?: number;
  pipTop?: number | string;
  pipRight?: number | string;

  style?: CSSProperties;
}

/**
 * FaceTime-style two-tile composition used across chat / show-and-tell /
 * goodbye / silly-faces / parent-check views. The big tile is the "other"
 * person; the PiP is "self." Both are live video when joined, fallback
 * images otherwise — UI never goes blank.
 */
export function FaceVideoStage({
  bigPerson,
  pipPerson,
  bigFallback,
  pipFallback,
  bigName,
  pipName,
  // Faces from typical webcams (4:3) get sliced badly by `cover` in our wide
  // landscape stages — we lose the chin/mouth. `contain` letterboxes the
  // edges over the dark backdrop but guarantees the whole face is visible.
  bigObjectFit = "contain",
  bigObjectPosition = "center center",
  pipObjectPosition = "center center",
  showGradient = true,
  bigOverlay,
  pipOverlay,
  children,
  pipWidth = 72,
  pipHeight = 96,
  pipTop = 12,
  pipRight = 12,
  style,
}: FaceVideoStageProps) {
  const { connectionId } = useVideoSession();
  // Tap-to-swap: clicking the PiP promotes it to the big tile; clicking
  // again restores. Local-only — Nana can flip her view without affecting
  // Perry's.
  const [swapped, setSwapped] = useState(false);
  const effectiveBig = swapped ? pipPerson : bigPerson;
  const effectivePip = swapped ? bigPerson : pipPerson;
  const effectiveBigFallback = swapped ? pipFallback : bigFallback;
  const effectivePipFallback = swapped ? bigFallback : pipFallback;
  const effectiveBigOverlay = swapped ? pipOverlay : bigOverlay;
  const effectivePipOverlay = swapped ? bigOverlay : pipOverlay;
  const { quality: bigQuality } = useVideoTile({ person: effectiveBig, connectionId });
  const liveDotColor = QUALITY_COLOR[bigQuality];

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        backgroundColor: "#000",
        ...style,
      }}
    >
      <FaceVideo
        person={effectiveBig}
        width="100%"
        height="100%"
        label={swapped ? pipName : bigName}
        fallbackSrc={effectiveBigFallback}
        objectFit={bigObjectFit}
        objectPosition={bigObjectPosition}
        showLabel={false}
        hideQualityDot
        borderRadius={0}
        overlay={effectiveBigOverlay}
        // Mirror only when showing self in the big slot (i.e., user swapped).
        autoMirror={swapped}
        style={{ border: "none", boxShadow: "none" }}
      />

      {showGradient && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, transparent 30%, transparent 60%, rgba(0,0,0,0.6) 100%)",
            pointerEvents: "none",
          }}
        />
      )}

      {bigName && (
        <div
          style={{
            position: "absolute",
            bottom: 12,
            left: 14,
            display: "flex",
            alignItems: "center",
            gap: 6,
            zIndex: 10,
          }}
        >
          <div
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              backgroundColor: liveDotColor,
              boxShadow: `0 0 6px ${liveDotColor}`,
              flexShrink: 0,
            }}
          />
          <span
            style={{
              color: "white",
              fontFamily: "DM Sans, sans-serif",
              fontSize: 13,
              fontWeight: 700,
              textShadow: "0 1px 6px rgba(0,0,0,0.9)",
            }}
          >
            {bigName}
          </span>
        </div>
      )}

      <button
        type="button"
        onClick={() => setSwapped((s) => !s)}
        aria-label={swapped ? "Restore original layout" : "Tap to swap views"}
        title={swapped ? "Tap to restore" : "Tap to swap views"}
        style={{
          position: "absolute",
          top: pipTop,
          right: pipRight,
          width: pipWidth,
          height: pipHeight,
          borderRadius: 10,
          overflow: "hidden",
          border: swapped ? "2px solid #C9922A" : "2px solid rgba(255,255,255,0.55)",
          boxShadow: swapped
            ? "0 6px 24px rgba(201,146,42,0.45), 0 0 0 3px rgba(201,146,42,0.18)"
            : "0 4px 16px rgba(0,0,0,0.6)",
          zIndex: 10,
          padding: 0,
          backgroundColor: "transparent",
          cursor: "pointer",
          transition: "border-color 200ms ease, box-shadow 200ms ease, transform 200ms cubic-bezier(0.32, 0.72, 0, 1)",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        <FaceVideo
          person={effectivePip}
          width="100%"
          height="100%"
          label={swapped ? bigName : pipName}
          fallbackSrc={effectivePipFallback}
          objectPosition={pipObjectPosition}
          showLabel={false}
          hideQualityDot
          borderRadius={0}
          overlay={effectivePipOverlay}
          // Mirror when self is in the PiP (default) — but not when swapped
          // (then "other" is in the PiP).
          autoMirror={!swapped}
          style={{ border: "none", boxShadow: "none" }}
        />
      </button>

      {children}
    </div>
  );
}
