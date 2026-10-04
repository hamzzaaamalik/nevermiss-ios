/**
 * Grandchild photos (Build 38): any picture from the iPad's library or
 * camera becomes a small square JPEG (about 320px, 120KB or less) so it
 * fits the server's limit and loads instantly on both iPads.
 */
const SIZE = 320;
const MAX_BYTES = 120 * 1024;

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That picture couldn't be opened. Try a different one.")); };
    img.src = url;
  });
}

function bytesOf(dataUrl: string): number {
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return Math.floor((b64.length * 3) / 4);
}

/** Center-crops to a square and compresses until it fits. */
export async function compressPhoto(file: Blob): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Please choose a picture.");
  const img = await loadImage(file);
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  if (!side) throw new Error("That picture couldn't be opened. Try a different one.");
  let size = SIZE;
  for (let attempt = 0; attempt < 3; attempt++) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This device can't prepare the picture.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);
    const sx = (img.naturalWidth - side) / 2;
    // Faces sit in the upper part of most portraits.
    const sy = Math.max(0, (img.naturalHeight - side) * 0.35);
    ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
    for (const q of [0.86, 0.78, 0.7, 0.6, 0.5]) {
      const url = canvas.toDataURL("image/jpeg", q);
      if (url.startsWith("data:image/jpeg") && bytesOf(url) <= MAX_BYTES) return url;
    }
    size = Math.round(size * 0.8);
  }
  throw new Error("That picture is too large. Try a different one.");
}

/** Opens the iPad's photo picker and resolves with the chosen file. */
export function pickPhotoFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.style.position = "fixed";
    input.style.left = "-9999px";
    let done = false;
    const finish = (f: File | null) => {
      if (done) return;
      done = true;
      input.remove();
      resolve(f);
    };
    input.addEventListener("change", () => finish(input.files?.[0] ?? null));
    input.addEventListener("cancel", () => finish(null));
    document.body.appendChild(input);
    input.click();
  });
}
