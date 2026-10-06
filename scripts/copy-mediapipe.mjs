// Copies MediaPipe's face-tracking WebAssembly from node_modules into
// public/ so Silly Faces loads it from inside the app, at the exact
// version the code was built against, instead of downloading ~11MB from a
// CDN on every launch (Rick's Build 36 #8). The face model itself is
// committed at public/mediapipe/face_landmarker.task.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "node_modules/@mediapipe/tasks-vision/wasm");
const to = join(root, "public/mediapipe/tasks-vision");
mkdirSync(to, { recursive: true });
for (const f of ["vision_wasm_internal.js", "vision_wasm_internal.wasm", "vision_wasm_nosimd_internal.js", "vision_wasm_nosimd_internal.wasm"]) {
  copyFileSync(join(from, f), join(to, f));
}
console.log("mediapipe wasm copied to public/mediapipe/tasks-vision");
