import { useEffect } from "react";
import * as FaceTracker from "./FaceTracker";

// Google-Meet-style "auto-framing" hook. Attaches to a <video> element
// found inside the given wrapper, runs MediaPipe face detection on every
// rAF tick (throttled), and dynamically adjusts `object-position` AND
// `transform: scale()` to:
//   1. Keep the face centered at (50%, 30%) of the displayed tile
//   2. Zoom OUT when the face occupies more than ~35% of the source
//      width (i.e. the user is sitting too close to their camera)
//
// Both adjustments are low-pass smoothed so they don't jitter as
// MediaPipe's per-frame estimates wobble. When the user moves their
// head naturally, the frame follows within ~250ms.

const DETECT_INTERVAL_MS_SINGLE = 50;
const DETECT_INTERVAL_MS_DOUBLE = 100;
const TARGET_FACE_FRACTION = 0.30; // face should fill ~30% of source width after auto-frame
const TARGET_FACE_POS_Y = 0.30;    // face center at 30% from top of tile

// Module-level counter so we know how many auto-frame loops are running.
// Used to dynamically throttle from 50ms to 100ms per tick when multiple
// tiles are active — keeps total CPU bounded.
let activeCount = 0;

interface AutoFrameOptions {
  /** When true, hook is inactive (no detection, no style updates). Used
   *  to pause during ceremony states or when the tile is not visible. */
  paused?: boolean;
  /** Default position fraction for tile-vertical placement of face.
   *  0.30 = face at top third (FaceTime convention). */
  targetPosY?: number;
}

export function useAutoFrame(
  wrapperRef: React.MutableRefObject<HTMLElement | null>,
  options: AutoFrameOptions = {},
) {
  const { paused = false, targetPosY = TARGET_FACE_POS_Y } = options;

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    activeCount += 1;

    let cancelled = false;
    let rvfcHandle: number | null = null;
    let intervalHandle: number | null = null;
    let lastDrawAt = 0;

    // Smoothed state. Start at sensible defaults so the first frame
    // doesn't pop. posX/posY are the object-position fractions (0..1).
    // scale is the CSS transform scale (1.0 = no zoom, <1.0 = zoom out).
    let smPosX = 0.5;
    let smPosY = targetPosY;
    let smScale = 1.0;

    let tracker: Awaited<ReturnType<typeof FaceTracker.getInstance>> = null;
    FaceTracker.getInstance().then(t => {
      if (!cancelled) tracker = t;
    }).catch(() => {});

    const useRvfc =
      "requestVideoFrameCallback" in HTMLVideoElement.prototype;

    const currentInterval = () =>
      activeCount >= 2 ? DETECT_INTERVAL_MS_DOUBLE : DETECT_INTERVAL_MS_SINGLE;

    let lastVideo: HTMLVideoElement | null = null;
    const getVideo = (): HTMLVideoElement | null => {
      if (lastVideo && lastVideo.isConnected) return lastVideo;
      lastVideo = wrapper.querySelector("video");
      return lastVideo;
    };

    const apply = (video: HTMLVideoElement) => {
      video.style.objectPosition = `${(smPosX * 100).toFixed(2)}% ${(smPosY * 100).toFixed(2)}%`;
      video.style.transform = smScale < 0.995 ? `scale(${smScale.toFixed(3)})` : "";
      video.style.transformOrigin = `${(smPosX * 100).toFixed(2)}% ${(smPosY * 100).toFixed(2)}%`;
    };

    const tick = (ts: number) => {
      if (cancelled) return;
      if (paused) {
        scheduleNext();
        return;
      }
      if (ts - lastDrawAt < currentInterval()) {
        scheduleNext();
        return;
      }
      lastDrawAt = ts;

      const video = getVideo();
      if (video && tracker && video.readyState >= 2 && video.videoWidth > 0) {
        let pose;
        try { pose = tracker.detect(video); } catch { pose = null; }
        if (pose) {
          const vw = video.videoWidth;
          const vh = video.videoHeight;
          const cw = video.clientWidth;
          const ch = video.clientHeight;
          if (cw > 0 && ch > 0) {
            // Compute desired zoom factor: if face is too big in
            // source, scale down so its DISPLAYED size matches the
            // target fraction. Clamp to [0.7, 1.0] so we never zoom in
            // (zooming in would amplify ugly cropping) and never zoom
            // out too far (1.0 is the natural display).
            const faceFraction = Math.min(1, pose.faceWidth / vw);
            let scale = TARGET_FACE_FRACTION / Math.max(0.05, faceFraction);
            scale = Math.max(0.7, Math.min(1.0, scale));

            // Compute object-position to put face center at (50%, targetPosY)
            // of the displayed tile. Math accounts for cover-mode overflow.
            // For a typical 4:3 source (vw/vh = 1.33) in any aspect tile,
            // scale_cover = max(cw/vw, ch/vh). Same formula as the existing
            // sticker math.
            const scaleCover = Math.max(cw / vw, ch / vh);
            const W = vw * scaleCover;
            const H = vh * scaleCover;
            const overflowX = W - cw;
            const overflowY = H - ch;
            const fxNorm = pose.nose.x / vw;
            const fyNorm = pose.nose.y / vh;
            let posX = 0.5;
            let posY = 0.5;
            if (overflowX > 0) {
              posX = (fxNorm * W - 0.5 * cw) / overflowX;
              posX = Math.max(0, Math.min(1, posX));
            }
            if (overflowY > 0) {
              posY = (fyNorm * H - targetPosY * ch) / overflowY;
              posY = Math.max(0, Math.min(1, posY));
            }

            // Smooth — 75% prev, 25% new. Fast enough to follow head
            // movement, slow enough to hide MediaPipe per-frame noise.
            smPosX = 0.75 * smPosX + 0.25 * posX;
            smPosY = 0.75 * smPosY + 0.25 * posY;
            smScale = 0.85 * smScale + 0.15 * scale;

            apply(video);
          }
        }
      }

      scheduleNext();
    };

    const useRvfcFor = (video: HTMLVideoElement | null): boolean =>
      !!video && useRvfc;

    const scheduleNext = () => {
      if (cancelled) return;
      const video = getVideo();
      if (useRvfcFor(video) && video) {
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
      activeCount = Math.max(0, activeCount - 1);
      const video = lastVideo;
      if (rvfcHandle !== null && video) {
        const cancel = (video as HTMLVideoElement & {
          cancelVideoFrameCallback?: (h: number) => void;
        }).cancelVideoFrameCallback;
        if (typeof cancel === "function") cancel.call(video, rvfcHandle);
      }
      if (intervalHandle !== null) window.clearTimeout(intervalHandle);
      // Reset inline styles so the next mount starts clean.
      if (video) {
        video.style.objectPosition = "";
        video.style.transform = "";
        video.style.transformOrigin = "";
      }
    };
  }, [wrapperRef, paused, targetPosY]);
}
