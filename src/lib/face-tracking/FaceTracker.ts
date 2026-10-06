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

class FaceTracker {
  private landmarker: FaceLandmarker | null = null;
  private failed = false;

  async init(): Promise<void> {
    if (this.landmarker || this.failed) return;
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
    this.landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
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

/** The shared tracker once loaded (null if loading failed). A load in
 *  progress is shared, never restarted: callers that grow impatient show
 *  a static sticker meanwhile and switch over when this resolves. After a
 *  failure the next call tries again with a fresh tracker. */
export function getInstance(): Promise<FaceTracker | null> {
  if (initPromise) return initPromise;
  const tracker = new FaceTracker();
  initPromise = tracker.init().then(
    () => { instance = tracker; return tracker; },
    () => { tracker.markFailed(); initPromise = null; return null; },
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
}

export type { FaceTracker };
