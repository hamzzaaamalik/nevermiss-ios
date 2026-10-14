import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import type { FacePose } from "./types";

// MediaPipe FaceLandmarker landmark indices we depend on (478-point model):
//   10  → top of forehead
//   1   → nose tip
//   152 → chin
//   234 → right cheekbone (subject's right; image left)
//   454 → left cheekbone
//   33  → outer right eye
//   263 → outer left eye
const FOREHEAD = 10;
const NOSE_TIP = 1;
const CHIN = 152;
const CHEEK_R = 234;
const CHEEK_L = 454;
const EYE_R = 33;
const EYE_L = 263;

// Bundled with the app (scripts/copy-mediapipe.mjs copies the WebAssembly
// at the exact library version; the model is committed): nothing to
// download from a CDN, which made Silly Faces take 8 to 10 seconds to
// respond (Rick's Build 36 #8).
const ASSET_BASE = `${(import.meta.env.BASE_URL || "/").replace(/\/?$/, "/")}mediapipe`;
const MODEL_URL = `${ASSET_BASE}/face_landmarker.task`;
const WASM_BASE = `${ASSET_BASE}/tasks-vision`;

// Rick's Build 40 review: on Perry's iPad Silly Faces took 40 to 50
// seconds the first time, then was quick. The GPU mode compiles its
// graphics shaders on first use, which WebKit does very slowly on iPads
// (the system keeps them afterwards). The CPU mode needs none and is fast
// enough for stickers, so iPads and Safari use it; other browsers keep
// the GPU. If the first choice fails, the other one is tried.
function preferCpu(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /AppleWebKit/.test(ua) && !/Chrome|Chromium|CriOS|Edg|FxiOS|Android/.test(ua);
}

class FaceTracker {
  private landmarker: FaceLandmarker | null = null;
  private failed = false;

  async init(): Promise<void> {
    if (this.landmarker || this.failed) return;
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
    const order: Array<"CPU" | "GPU"> = preferCpu() ? ["CPU", "GPU"] : ["GPU", "CPU"];
    let lastErr: unknown = null;
    for (const delegate of order) {
      try {
        this.landmarker = await this.create(fileset, delegate);
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (!this.landmarker) throw lastErr ?? new Error("Face tracking could not start.");
    // One detection on a blank frame warms the model up now, in the
    // background, instead of when Silly Faces first opens.
    try {
      const warm = document.createElement("canvas");
      warm.width = 64;
      warm.height = 64;
      const ctx = warm.getContext("2d");
      if (ctx) { ctx.fillStyle = "#808080"; ctx.fillRect(0, 0, 64, 64); }
      this.landmarker.detect(warm);
    } catch {
      // A warm-up that fails changes nothing: the first real frame warms it.
    }
  }

  private create(fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>, delegate: "CPU" | "GPU"): Promise<FaceLandmarker> {
    return FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      // IMAGE mode (stateless per call) instead of VIDEO. Reason: the
      // singleton instance is shared by BOTH SillyFaces tiles. VIDEO mode
      // keeps temporal tracker state across calls — when alternating
      // sources (videoA then videoB), the model treats the second frame
      // as a continuation of the first and frequently returns no-face.
      // Symptom: only one sticker visible at a time; the OTHER tile's
      // detection silently fails. IMAGE mode runs detection from scratch
      // every call: ~10-15ms instead of ~5-10ms on iPad, still well
      // within the 50ms (single) / 100ms (dual) throttle budget.
      runningMode: "IMAGE",
      numFaces: 1,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
      // Defaults are 0.5 — too high for faces sitting further from the
      // camera (older laptop webcam framing the user small in the frame).
      // Rick: "Nana is connected from laptop chrome which has old camera,
      // so when nana moves close to the camera then it appears." Dropping
      // to 0.3 gives the tracker headroom to lock onto small/profile
      // faces while staying comfortably above noise (random pixels return
      // confidence near 0).
      minFaceDetectionConfidence: 0.3,
      minFacePresenceConfidence: 0.3,
      minTrackingConfidence: 0.3,
    });
  }

  detect(video: HTMLVideoElement): FacePose | null {
    if (!this.landmarker || this.failed) return null;
    if (video.readyState < 2 || video.videoWidth === 0) return null;

    let result;
    try {
      result = this.landmarker.detect(video);
    } catch {
      return null;
    }

    const faces = result.faceLandmarks;
    if (!faces || faces.length === 0) return null;
    const lm = faces[0];
    if (!lm || lm.length < 478) return null;

    const w = video.videoWidth;
    const h = video.videoHeight;

    const forehead = { x: lm[FOREHEAD].x * w, y: lm[FOREHEAD].y * h };
    const nose = { x: lm[NOSE_TIP].x * w, y: lm[NOSE_TIP].y * h };
    const chin = { x: lm[CHIN].x * w, y: lm[CHIN].y * h };
    const cheekR = { x: lm[CHEEK_R].x * w, y: lm[CHEEK_R].y * h };
    const cheekL = { x: lm[CHEEK_L].x * w, y: lm[CHEEK_L].y * h };
    const eyeR = { x: lm[EYE_R].x * w, y: lm[EYE_R].y * h };
    const eyeL = { x: lm[EYE_L].x * w, y: lm[EYE_L].y * h };

    const dx = cheekL.x - cheekR.x;
    const dy = cheekL.y - cheekR.y;
    const faceWidth = Math.hypot(dx, dy);
    const faceHeight = Math.hypot(chin.x - forehead.x, chin.y - forehead.y);
    // Roll from the eye line — more stable than the cheek line because the
    // cheekbones drift with smile / jaw motion. atan2(Δy, Δx) on left-eye
    // minus right-eye: a head tilt where the right ear comes down rotates
    // the eye line clockwise in image space, giving a positive angle.
    const roll = Math.atan2(eyeL.y - eyeR.y, eyeL.x - eyeR.x);

    if (faceWidth < 8 || faceHeight < 8) return null;

    return { forehead, nose, faceWidth, faceHeight, roll };
  }

  dispose(): void {
    if (this.landmarker) {
      try {
        this.landmarker.close();
      } catch {
        // best-effort
      }
      this.landmarker = null;
    }
    this.failed = false;
  }

  markFailed(): void {
    this.failed = true;
  }

  isFailed(): boolean {
    return this.failed;
  }
}

let instance: FaceTracker | null = null;
let initPromise: Promise<FaceTracker | null> | null = null;
let loading = false;
const loadingListeners = new Set<() => void>();
const setLoading = (on: boolean) => {
  if (loading === on) return;
  loading = on;
  for (const l of loadingListeners) l();
};

/** Face tracking is loading right now (Silly Faces says "Getting the silly
 *  faces ready…"). False once loaded, and after a failed load, when the
 *  stickers sit still instead. */
export function isLoading(): boolean {
  return loading;
}
export function subscribeLoading(cb: () => void): () => void {
  loadingListeners.add(cb);
  return () => { loadingListeners.delete(cb); };
}

/** The shared tracker once loaded (null if loading failed). A load in
 *  progress is shared, never restarted: callers that grow impatient show
 *  a static sticker meanwhile and switch over when this resolves. After a
 *  failure the next call tries again with a fresh tracker. */
export function getInstance(): Promise<FaceTracker | null> {
  if (initPromise) return initPromise;
  const tracker = new FaceTracker();
  setLoading(true);
  initPromise = tracker.init().then(
    () => { instance = tracker; setLoading(false); return tracker; },
    () => { tracker.markFailed(); initPromise = null; setLoading(false); return null; },
  );
  return initPromise;
}

/** Start loading quietly when a visit begins, so Silly Faces is ready the
 *  moment it opens. Waits for an idle moment; loading compiles about 11MB
 *  of WebAssembly. */
export function preload(delayMs = 2500): void {
  if (initPromise || instance) return;
  window.setTimeout(() => {
    const go = () => { void getInstance(); };
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
    if (ric) ric(go, { timeout: 4000 }); else go();
  }, delayMs);
}

export function dispose(): void {
  if (instance) {
    instance.dispose();
    instance = null;
  }
  initPromise = null;
  setLoading(false);
}

export type { FaceTracker };
