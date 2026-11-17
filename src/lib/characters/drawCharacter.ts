import type { CharacterId, FaceExpr } from "./characterBus";

/**
 * NeverMiss's own characters, drawn in code (Build 44). Friendly and round,
 * with big readable eyes and mouth: they blink, raise their brows, talk,
 * smile and turn their head with the person behind them.
 */

interface Palette {
  sky: [string, string];
  face: [string, string];
  muzzle: string;
  ear: string;
  earIn: string;
  feature: string;
  brow: string;
  mane?: [string, string];
  patch?: string;
}
const PALETTES: Record<CharacterId, Palette> = {
  lion: {
    sky: ["#FFE9B8", "#F4A95E"], face: ["#F8C86A", "#E59A33"], muzzle: "#FCE6B9", ear: "#E59A33", earIn: "#F8CB86",
    feature: "#5A3018", brow: "#8A4A16", mane: ["#D06A1E", "#A3460F"],
  },
  panda: {
    sky: ["#E3F7E4", "#93D3A0"], face: ["#FFFFFF", "#E9EAE6"], muzzle: "#FFFFFF", ear: "#26272B", earIn: "#3A3B40",
    feature: "#1E1F23", brow: "#2E2F34", patch: "#26272B",
  },
};

export function drawCharacter(ctx: CanvasRenderingContext2D, w: number, h: number, id: CharacterId, e: FaceExpr, t: number): void {
  const p = PALETTES[id];
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  // Sky behind the character.
  const bg = ctx.createRadialGradient(w / 2, h * 0.35, 10, w / 2, h * 0.5, Math.max(w, h) * 0.8);
  bg.addColorStop(0, p.sky[0]);
  bg.addColorStop(1, p.sky[1]);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const R = Math.min(w, h) * 0.3;
  // No face in view: a gentle idle look-around instead of a frozen face.
  const idle = e.seen < 0.5;
  const yaw = idle ? Math.sin(t * 0.7) * 0.25 : e.yaw;
  const pitch = idle ? Math.sin(t * 0.5) * 0.08 : e.pitch;
  const roll = idle ? Math.sin(t * 0.9) * 0.05 : e.roll;
  const breathe = 1 + Math.sin(t * 2.1) * 0.012;
  const cx = w / 2 + yaw * R * 0.35;
  const cy = h * 0.54 + pitch * R * 0.35;
  ctx.translate(cx, cy);
  ctx.rotate(roll);
  ctx.scale(breathe * (1 - Math.abs(yaw) * 0.08), breathe);
  const fx = yaw * R * 0.3;
  const fy = pitch * R * 0.2;

  // Soft shadow under the head.
  ctx.fillStyle = "rgba(60,30,10,0.12)";
  ctx.beginPath(); ctx.ellipse(0, R * 1.32, R * 0.95, R * 0.16, 0, 0, Math.PI * 2); ctx.fill();

  // Lion's mane.
  if (p.mane) {
    const lobes = 18;
    for (let ring = 0; ring < 2; ring++) {
      for (let i = 0; i < lobes; i++) {
        const a = (i / lobes) * Math.PI * 2 + ring * (Math.PI / lobes) + Math.sin(t * 1.3 + i) * 0.015;
        const dist = R * (ring ? 1.08 : 1.2);
        const g = ctx.createRadialGradient(Math.cos(a) * dist, Math.sin(a) * dist, 2, Math.cos(a) * dist, Math.sin(a) * dist, R * 0.46);
        g.addColorStop(0, ring ? p.mane[0] : p.mane[1]);
        g.addColorStop(1, ring ? p.mane[1] : "#7E3409");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(Math.cos(a) * dist, Math.sin(a) * dist, R * (ring ? 0.4 : 0.44), 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  // Ears.
  for (const side of [-1, 1]) {
    const ex = side * R * (p.mane ? 0.66 : 0.7) + fx * 0.4;
    const ey = -R * (p.mane ? 0.74 : 0.78) + fy * 0.4;
    ctx.fillStyle = p.ear;
    ctx.beginPath(); ctx.arc(ex, ey, R * 0.28, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = p.earIn;
    ctx.beginPath(); ctx.arc(ex, ey + R * 0.02, R * 0.15, 0, Math.PI * 2); ctx.fill();
  }

  // Face.
  const fg = ctx.createRadialGradient(fx * 0.5, -R * 0.3 + fy, R * 0.2, 0, 0, R * 1.05);
  fg.addColorStop(0, p.face[0]);
  fg.addColorStop(1, p.face[1]);
  ctx.fillStyle = fg;
  ctx.beginPath(); ctx.ellipse(0, 0, R * 0.95, R, 0, 0, Math.PI * 2); ctx.fill();
  if (!p.mane) { ctx.strokeStyle = "rgba(0,0,0,0.08)"; ctx.lineWidth = R * 0.03; ctx.stroke(); }

  // Panda's eye patches.
  if (p.patch) {
    ctx.fillStyle = p.patch;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(side * R * 0.34 + fx, -R * 0.04 + fy, R * 0.22, R * 0.29, side * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Muzzle.
  ctx.fillStyle = p.muzzle;
  ctx.beginPath(); ctx.ellipse(fx, R * 0.36 + fy, R * 0.48, R * 0.34, 0, 0, Math.PI * 2); ctx.fill();

  // Cheeks blush with a smile.
  if (e.smile > 0.15) {
    ctx.fillStyle = `rgba(255,120,130,${Math.min(0.45, (e.smile - 0.15) * 0.7)})`;
    for (const side of [-1, 1]) { ctx.beginPath(); ctx.arc(side * R * 0.6 + fx, R * 0.24 + fy, R * 0.13, 0, Math.PI * 2); ctx.fill(); }
  }

  // Eyes (they look where the head turns; they close with a blink).
  const lookX = yaw * R * 0.05, lookY = pitch * R * 0.04;
  for (const side of [-1, 1]) {
    const blink = side < 0 ? e.blinkL : e.blinkR;
    const open = Math.max(0.08, 1 - blink);
    const ex = side * R * 0.34 + fx, ey = -R * 0.06 + fy;
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath(); ctx.ellipse(ex, ey, R * 0.15, R * 0.18 * open, 0, 0, Math.PI * 2); ctx.fill();
    if (open > 0.25) {
      ctx.save();
      ctx.beginPath(); ctx.ellipse(ex, ey, R * 0.15, R * 0.18 * open, 0, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = p.feature;
      ctx.beginPath(); ctx.arc(ex + lookX, ey + lookY + R * 0.02, R * 0.095, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#FFFFFF";
      ctx.beginPath(); ctx.arc(ex + lookX + R * 0.035, ey + lookY - R * 0.02, R * 0.03, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else {
      ctx.strokeStyle = p.feature; ctx.lineWidth = R * 0.035; ctx.lineCap = "round";
      ctx.beginPath(); ctx.arc(ex, ey - R * 0.04, R * 0.12, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
    }
    // Brow.
    const lift = e.brow * R * 0.14;
    ctx.strokeStyle = p.brow; ctx.lineWidth = R * 0.055; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(ex - side * R * 0.13, ey - R * 0.27 - lift * 1.1);
    ctx.quadraticCurveTo(ex, ey - R * 0.34 - lift, ex + side * R * 0.13, ey - R * 0.25 - lift * 0.6);
    ctx.stroke();
  }

  // Nose.
  ctx.fillStyle = p.feature;
  ctx.beginPath();
  const nx = fx, ny = R * 0.18 + fy;
  ctx.moveTo(nx - R * 0.13, ny - R * 0.06);
  ctx.quadraticCurveTo(nx, ny - R * 0.11, nx + R * 0.13, ny - R * 0.06);
  ctx.quadraticCurveTo(nx + R * 0.05, ny + R * 0.09, nx, ny + R * 0.1);
  ctx.quadraticCurveTo(nx - R * 0.05, ny + R * 0.09, nx - R * 0.13, ny - R * 0.06);
  ctx.fill();

  // Mouth: talks when the jaw opens, smiles at the corners.
  const mx = fx, my = R * 0.43 + fy;
  ctx.strokeStyle = p.feature; ctx.lineWidth = R * 0.04; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(nx, ny + R * 0.1); ctx.lineTo(mx, my - R * 0.03); ctx.stroke();
  if (e.jaw > 0.08) {
    const mw = R * (0.17 + e.smile * 0.08 - e.pucker * 0.07);
    const mh = R * (0.05 + e.jaw * 0.25);
    ctx.fillStyle = "#7A1F2B";
    ctx.beginPath(); ctx.ellipse(mx, my + mh * 0.75, mw, mh, 0, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.beginPath(); ctx.ellipse(mx, my + mh * 0.75, mw, mh, 0, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = "#EA6F80";
    ctx.beginPath(); ctx.ellipse(mx, my + mh * 1.45, mw * 0.75, mh * 0.6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  } else {
    const curve = R * (0.03 + e.smile * 0.13 - e.pucker * 0.05);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(mx, my - R * 0.03);
      ctx.quadraticCurveTo(mx + side * R * 0.1, my + curve, mx + side * R * (0.2 + e.smile * 0.05), my - curve * 0.4);
      ctx.stroke();
    }
  }

  // Lion's whisker dots.
  if (p.mane) {
    ctx.fillStyle = "rgba(90,48,24,0.55)";
    for (const side of [-1, 1]) for (let k = 0; k < 3; k++) {
      ctx.beginPath(); ctx.arc(mx + side * R * (0.24 + k * 0.08), R * 0.33 + fy + (k % 2) * R * 0.05, R * 0.018, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}
