import { FaceLandmarker, FilesetResolver, type FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import { NEUTRAL, type FaceExpr } from "./characterBus";

/**
 * Reads this iPad's own face for the animated characters: MediaPipe's
 * face model with its 52 expression values (the same set Apple's ARKit
 * uses) and the head's turn. Separate from the sticker tracker, which
 * looks at both tiles without expressions; this one follows one camera,
 * so it runs in video mode (steadier, and cheaper per frame).
 */
const ASSET_BASE = `${(import.meta.env.BASE_URL || "/").replace(/\/?$/, "/")}mediapipe`;

let instance: Promise<FaceLandmarker | null> | null = null;
function preferCpu(): boolean {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  return /AppleWebKit/.test(ua) && !/Chrome|Chromium|CriOS|Edg|FxiOS|Android/.test(ua);
}
export function getExpressionTracker(): Promise<FaceLandmarker | null> {
  if (!instance) {
    instance = (async () => {
      try {
        const fileset = await FilesetResolver.forVisionTasks(`${ASSET_BASE}/tasks-vision`);
        const make = (delegate: "CPU" | "GPU") => FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: `${ASSET_BASE}/face_landmarker.task`, delegate },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
          minFaceDetectionConfidence: 0.3,
          minFacePresenceConfidence: 0.3,
          minTrackingConfidence: 0.3,
        });
        const first = preferCpu() ? "CPU" : "GPU";
        try { return await make(first); } catch { return await make(first === "CPU" ? "GPU" : "CPU"); }
      } catch {
        instance = null;
        return null;
      }
    })();
  }
  return instance;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
let lastTs = 0;

/** One reading of the face in `video`, or null when no face is in view. */
export function readExpression(lm: FaceLandmarker, video: HTMLVideoElement): FaceExpr | null {
  if (video.readyState < 2 || !video.videoWidth) return null;
  let ts = performance.now();
  if (ts <= lastTs) ts = lastTs + 1;
  lastTs = ts;
  let r: FaceLandmarkerResult;
  try { r = lm.detectForVideo(video, ts); } catch { return null; }
  const cats = r.faceBlendshapes?.[0]?.categories;
  if (!cats?.length) return null;
  const s: Record<string, number> = {};
  for (const c of cats) s[c.categoryName] = c.score;
  const e: FaceExpr = { ...NEUTRAL, seen: 1 };
  e.jaw = clamp((s.jawOpen ?? 0) * 1.35, 0, 1);
  e.smile = clamp(((s.mouthSmileLeft ?? 0) + (s.mouthSmileRight ?? 0)) / 2 * 1.4, 0, 1);
  e.blinkL = clamp((s.eyeBlinkLeft ?? 0) * 1.25, 0, 1);
  e.blinkR = clamp((s.eyeBlinkRight ?? 0) * 1.25, 0, 1);
  e.brow = clamp(Math.max(s.browInnerUp ?? 0, ((s.browOuterUpLeft ?? 0) + (s.browOuterUpRight ?? 0)) / 2) * 1.3, 0, 1);
  e.pucker = clamp(Math.max(s.mouthPucker ?? 0, s.mouthFunnel ?? 0), 0, 1);
  const m = r.facialTransformationMatrixes?.[0]?.data;
  if (m && m.length >= 16) {
    // Column-major 4x4: the rotation part gives the head's turn.
    const r00 = m[0], r10 = m[1], r20 = m[2], r21 = m[6], r22 = m[10];
    e.pitch = clamp(Math.atan2(r21, r22), -0.7, 0.7);
    e.yaw = clamp(Math.atan2(-r20, Math.hypot(r21, r22)), -0.8, 0.8);
    e.roll = clamp(Math.atan2(r10, r00), -0.6, 0.6);
  }
  return e;
}
