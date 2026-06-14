import { useEffect, useRef, useState } from "react";
import { FilterOverlay } from "../../App";
import * as FaceTracker from "./FaceTracker";
import { findSticker, mapLegacyFilterId } from "./stickerCatalog";
import type { FacePose, Sticker } from "./types";

// Throttle detection to ~20fps. MediaPipe at 30fps with the float16 model
// pegs an iPad CPU; 20fps is plenty for stickers that visually integrate
// because the human eye fuses motion above ~15fps and faces don't whip
// around faster than the network video frame rate anyway.
const DETECT_INTERVAL_MS_SINGLE = 50;
// When BOTH tiles are tracking (Nana picked a sticker AND Perry picked a
// sticker), the shared FaceLandmarker processes sequentially — two
// detections per tick blows the main-thread budget on iPad and the whole
// session stutters/drops/errors. Doubling the interval keeps per-tile
// at ~10fps but holds the combined CPU at the same single-tile budget.
// Rick: "both are doing then its breaks and slows even and sometimes
// even stops."
const DETECT_INTERVAL_MS_DOUBLE = 100;

// Module-level counter of how many TrackedCanvas instances are currently
// mounted with a non-floater sticker. The tick loop reads this each tick
// (live, not closure-captured) so adding/removing a tile changes the
// detection cadence immediately.
let activeTrackerCount = 0;

// Parse a CSS object-position value ("center 30%", "50% 50%", "left top",
// etc.) into normalized [0..1, 0..1] fractions. Used by the sticker math
// to honor the video's CSS positioning instead of assuming center-50%.
function parseObjectPosition(s: string): [number, number] {
  const parts = s.trim().split(/\s+/);
  const parseOne = (p: string | undefined): number => {
    if (!p) return 0.5;
    if (p === "center") return 0.5;
    if (p === "left" || p === "top") return 0;
    if (p === "right" || p === "bottom") return 1;
    if (p.endsWith("%")) return parseFloat(p) / 100;
    return 0.5;
  };
  return [parseOne(parts[0]), parseOne(parts[1])];
}

interface FaceTrackedOverlayProps {
  filterId: string;
  /** Mirror the canvas horizontally to match the video element's
   *  autoMirror state. Without this, when the local participant's video
   *  is mirrored, the sticker draws on the OPPOSITE side of the face. */
  mirrored?: boolean;
  /** When true, freeze the existing canvas and skip detection. Used
   *  during the silly-faces challenge counting/flash/holding states so
   *  the CPU isn't fighting MediaPipe + the ceremony animation. */
  paused?: boolean;
}

export function FaceTrackedOverlay({ filterId, mirrored = false, paused = false }: FaceTrackedOverlayProps) {
  const mappedId = mapLegacyFilterId(filterId);
  const sticker = findSticker(mappedId);

  // Floaters use the legacy CSS overlay — no canvas + no MediaPipe.
  if (sticker && sticker.kind === "floater") {
    return <FilterOverlay filter={mappedId} />;
  }

  // For unknown ids that aren't "none", fall back to legacy CSS too.
  if (filterId && filterId !== "none" && mappedId !== "none" && !sticker) {
    return <FilterOverlay filter={mappedId} />;
  }

  // Mount TrackedCanvas even when filterId is "none" so the SMART-CROP
  // (Google-Meet-style face-aware object-position) keeps running. The
  // canvas itself only draws a sticker if one is selected; the
  // object-position update happens on every detected frame regardless.
  // The pose-driven crop fixes the "iPhone portrait source looks zoomed
  // in a landscape tile" issue by sliding the cover crop so the face
  // sits at ~30% of the tile vertically.
  const isNone = !filterId || filterId === "none" || mappedId === "none";
  return <TrackedCanvas sticker={isNone ? null : sticker ?? null} legacyFilterId={mappedId} mirrored={mirrored} paused={paused} />;
}

/**
 * Catalog-aware static fallback used when MediaPipe failed to init.
 * Renders the sticker's emoji at a sensible position WITHOUT tracking:
 *   - head sticker → near the top of the tile (above where the face sits)
 *   - mask sticker → centered on the tile (over the face area)
 * Visible to everyone for every catalog entry — so even when tracking
 * is unavailable on a device, the kid still sees the sticker the
 * other person picked.
 */
function StaticStickerFallback({ sticker }: { sticker: Sticker }) {
  const isHead = sticker.kind === "head";
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 5 }}>
      <span
        style={{
          position: "absolute",
          left: "50%",
          top: isHead ? "8%" : "50%",
          transform: isHead ? "translateX(-50%)" : "translate(-50%, -50%)",
          fontSize: isHead ? "clamp(64px, 22vh, 130px)" : "clamp(80px, 30vh, 180px)",
          lineHeight: 1,
          filter: "drop-shadow(0 4px 14px rgba(0,0,0,0.6))",
          // Soft fade-in so the swap doesn't feel jarring when tracking
          // had previously been working and just fell over.
          animation: "phase-intro-fade 0.3s ease-out",
        }}
        aria-hidden
      >
        {sticker.emoji}
      </span>
    </div>
  );
}

function TrackedCanvas({
  sticker,
  legacyFilterId,
  mirrored,
  paused,
}: {
  sticker: Sticker | null;
  legacyFilterId: string;
  mirrored: boolean;
  paused: boolean;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [initFailed, setInitFailed] = useState(false);
  // Pause flag read inside the tick closure — useRef so the running loop
  // sees the latest value without remounting (which would tear down
  // MediaPipe + canvas state).
  const pausedRef = useRef(paused);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!wrapper || !canvas) return;

    const video = wrapper.parentElement?.querySelector("video") ?? null;
    if (!video) return;

    activeTrackerCount += 1;

    let cancelled = false;
    let rvfcHandle: number | null = null;
    let intervalHandle: number | null = null;
    let lastDrawAt = 0;

    const useRvfc =
      "requestVideoFrameCallback" in HTMLVideoElement.prototype &&
      typeof (video as HTMLVideoElement & {
        requestVideoFrameCallback?: unknown;
      }).requestVideoFrameCallback === "function";

    // Match canvas backing-store size to the displayed video element. We
    // size to the video element's CLIENT box (post layout, post object-fit)
    // because the canvas overlays the rendered tile, not the raw camera
    // frame. Anchor points come from the camera frame though — we convert
    // by scaling forehead.x/y from videoWidth → clientWidth.
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = video.clientWidth;
      const h = video.clientHeight;
      if (w === 0 || h === 0) return;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    };
    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(video);
    window.addEventListener("resize", resize);

    let tracker: Awaited<ReturnType<typeof FaceTracker.getInstance>> = null;
    FaceTracker.getInstance().then(t => {
      if (cancelled) return;
      tracker = t;
      // Reflect the latest attempt's outcome BOTH ways. A previous
      // failure on this device may have set initFailed=true; if the
      // retry just succeeded, clear it so the canvas resumes. Symmetric
      // setInitFailed(true) on a fresh failure.
      if (t) setInitFailed(false);
      else setInitFailed(true);
    }).catch(() => {
      if (!cancelled) setInitFailed(true);
    });

    // Note: smart-crop / auto-frame is no longer duplicated here. The
    // FaceVideo component now runs useAutoFrame on its wrapper which
    // drives object-position + transform: scale() across ALL face video
    // surfaces (PiP, reading, chat, show-and-tell, silly faces, …). This
    // component is now ONLY responsible for drawing stickers on the
    // canvas overlay; the canvas math reads the LIVE object-position
    // from computed style each draw, so it stays in lockstep with
    // whatever auto-frame is currently doing.

    const drawPose = (pose: FacePose | null) => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!pose) return;

      // No sticker selected → nothing to draw. Auto-frame still runs
      // independently via FaceVideo's useAutoFrame hook.
      if (!sticker) return;

      // Convert camera-frame pixels → displayed-tile pixels. The video may
      // be mirrored (autoMirror) by the DailyVideo CSS transform — the
      // mirror happens AFTER our canvas paints, so we draw in unmirrored
      // camera space and the parent flip carries the canvas with it.
      const vw = video.videoWidth || 1;
      const vh = video.videoHeight || 1;
      const cw = video.clientWidth;
      const ch = video.clientHeight;
      // Auto-detect object-fit AND object-position from the LIVE video
      // computed style. The smart-crop updates object-position every
      // tick, so parsing it back here is how the sticker math stays in
      // lockstep with the cropped frame.
      const cs = window.getComputedStyle(video);
      const fit = cs.objectFit || "cover";
      const scale = fit === "contain"
        ? Math.min(cw / vw, ch / vh)
        : Math.max(cw / vw, ch / vh);
      const [posX, posY] = parseObjectPosition(cs.objectPosition || "50% 50%");
      const offX = -(vw * scale - cw) * posX;
      const offY = -(vh * scale - ch) * posY;
      const tx = (x: number) => x * scale + offX;
      const ty = (y: number) => y * scale + offY;

      ctx.save();

      if (sticker.kind === "head") {
        const yOffset = sticker.yOffset ?? -0.45;
        const sScale = sticker.scale ?? 1.2;
        const ax = tx(pose.forehead.x);
        const ay = ty(pose.forehead.y);
        const fontPx = sScale * pose.faceWidth * scale;
        ctx.translate(ax, ay);
        ctx.rotate(pose.roll);
        // yOffset is in face-height units; apply AFTER rotation so the hat
        // rides above the forehead in the head's own rotated frame.
        ctx.translate(0, yOffset * pose.faceHeight * scale);
        ctx.font = `${fontPx}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(sticker.emoji, 0, 0);
      } else {
        // mask
        const sScale = sticker.scale ?? 1.4;
        const ax = tx(pose.nose.x);
        const ay = ty(pose.nose.y);
        const fontPx = sScale * pose.faceHeight * scale;
        ctx.translate(ax, ay);
        ctx.rotate(pose.roll);
        ctx.font = `${fontPx}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(sticker.emoji, 0, 0);
      }

      ctx.restore();
    };

    const currentInterval = () =>
      activeTrackerCount >= 2 ? DETECT_INTERVAL_MS_DOUBLE : DETECT_INTERVAL_MS_SINGLE;

    const tick = (ts: number) => {
      if (cancelled) return;
      // While paused (challenge ceremony), don't run MediaPipe — keep the
      // last drawn sticker frozen in place. Polls still re-arm so we
      // resume cleanly when paused flips back to false.
      if (pausedRef.current) {
        scheduleNext();
        return;
      }
      if (ts - lastDrawAt < currentInterval()) {
        scheduleNext();
        return;
      }
      lastDrawAt = ts;
      if (tracker) {
        // IMAGE mode — stateless, no timestamp needed.
        const pose = tracker.detect(video);
        drawPose(pose);
      }
      scheduleNext();
    };

    const scheduleNext = () => {
      if (cancelled) return;
      if (useRvfc) {
        rvfcHandle = (video as HTMLVideoElement & {
          requestVideoFrameCallback: (cb: (now: number) => void) => number;
        }).requestVideoFrameCallback(now => tick(now));
      } else {
        intervalHandle = window.setTimeout(() => tick(performance.now()), currentInterval());
      }
    };

    scheduleNext();

    return () => {
      cancelled = true;
      activeTrackerCount = Math.max(0, activeTrackerCount - 1);
      ro.disconnect();
      window.removeEventListener("resize", resize);
      if (rvfcHandle !== null) {
        const cancel = (video as HTMLVideoElement & {
          cancelVideoFrameCallback?: (h: number) => void;
        }).cancelVideoFrameCallback;
        if (typeof cancel === "function") cancel.call(video, rvfcHandle);
      }
      if (intervalHandle !== null) window.clearTimeout(intervalHandle);
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      // Reset the smart-crop inline style so the next mount starts from
      // whatever CSS provides instead of the last face's position.
      video.style.objectPosition = "";
    };
  }, [sticker]);

  // Init-failure fallback. Two layers:
  //
  //   1) If the selected filter is a sticker we know about (head OR
  //      mask), draw the emoji at a sensible static position so users
  //      ALWAYS see something — even when MediaPipe can't load. Head
  //      stickers ride near the top of the tile (above where the face
  //      sits), masks sit at center. Static — no face tracking — but
  //      visible. Rick: "on perry side nothing is shown on face mask
  //      filters" was caused by FilterOverlay not knowing the new
  //      mask IDs, leaving the fallback path returning null.
  //
  //   2) Otherwise fall back to the legacy CSS overlay (covers floater
  //      IDs + the small set of legacy head IDs that pre-date the
  //      sticker catalog).
  if (initFailed && sticker) {
    return <StaticStickerFallback sticker={sticker} />;
  }
  if (initFailed) {
    return <FilterOverlay filter={legacyFilterId} />;
  }

  return (
    <div
      ref={wrapperRef}
      style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 5 }}
    >
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          // Mirror the canvas to match Daily's autoMirror on the video.
          // MediaPipe reads RAW frame coords; if the video is mirrored
          // for display, the canvas must mirror too so the sticker lands
          // on the same visual side as the face. Without this, when the
          // user tilts head right the sticker appears on their visual
          // left because canvas pixel (x) was drawn at raw x while the
          // user appears at (width - rawX).
          transform: mirrored ? "scaleX(-1)" : undefined,
        }}
      />
    </div>
  );
}
