import { useEffect, useRef, useState } from "react";
import { characterBus, NEUTRAL, packExpr, unpackExpr, type CharacterId, type FaceExpr } from "./characterBus";
import { getExpressionTracker, readExpression } from "./expressionTracker";
import { drawCharacter } from "./drawCharacter";

/**
 * Draws a character over a video tile (Build 44).
 *  - "local": this iPad's own tile. Reads the face from the tile's video
 *    (about 12 times a second), draws the character mirrored like a
 *    mirror, and sends the expression to the other iPad.
 *  - "remote": the other person's tile. Draws whatever character and
 *    expression the other iPad sends; nothing shows until it does.
 * Drawing runs every frame and eases toward the latest reading, so the
 * character moves smoothly between readings.
 */
const READ_EVERY_MS = 80;
const SEND_EVERY_MS = 80;
const REMOTE_STALE_MS = 2500;

const ease = (a: FaceExpr, b: FaceExpr, k: number): FaceExpr => {
  const o = { ...a };
  (Object.keys(o) as Array<keyof FaceExpr>).forEach(key => { o[key] = a[key] + (b[key] - a[key]) * k; });
  return o;
};
const mirror = (e: FaceExpr): FaceExpr => ({ ...e, yaw: -e.yaw, roll: -e.roll, blinkL: e.blinkR, blinkR: e.blinkL });

export function CharacterLayer({ mode, character }: { mode: "local" | "remote"; character?: CharacterId | null }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [remoteChar, setRemoteChar] = useState<CharacterId | null>(null);
  const shown = mode === "local" ? character ?? null : remoteChar;
  const targetRef = useRef<FaceExpr>(NEUTRAL);
  const lastMsgRef = useRef(0);

  // The other iPad's character and expressions.
  useEffect(() => {
    if (mode !== "remote") return;
    const off = characterBus.subscribe(m => {
      lastMsgRef.current = Date.now();
      setRemoteChar(m.c);
      const e = unpackExpr(m.e);
      if (e) targetRef.current = e;
    });
    const t = window.setInterval(() => { if (Date.now() - lastMsgRef.current > REMOTE_STALE_MS) setRemoteChar(null); }, 1000);
    return () => { off(); window.clearInterval(t); };
  }, [mode]);

  // This iPad: read the face and send it.
  useEffect(() => {
    if (mode !== "local") return;
    if (!character) { characterBus.send({ t: "chr", ts: Date.now(), c: null }); return; }
    let alive = true;
    let timer = 0;
    let lastSend = 0;
    const findVideo = () => canvasRef.current?.parentElement?.parentElement?.querySelector("video") ?? null;
    void getExpressionTracker().then(lm => {
      if (!alive) return;
      const step = () => {
        if (!alive) return;
        const video = findVideo();
        const read = lm && video ? readExpression(lm, video) : null;
        targetRef.current = read ?? { ...targetRef.current, seen: 0 };
        const now = Date.now();
        if (now - lastSend >= SEND_EVERY_MS) {
          lastSend = now;
          characterBus.send({ t: "chr", ts: now, c: character, e: packExpr(targetRef.current) });
        }
        timer = window.setTimeout(step, READ_EVERY_MS);
      };
      step();
    });
    return () => { alive = false; window.clearTimeout(timer); characterBus.send({ t: "chr", ts: Date.now(), c: null }); };
  }, [mode, character]);

  // Draw every frame, easing toward the latest reading.
  useEffect(() => {
    if (!shown) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf = 0;
    let cur: FaceExpr = { ...NEUTRAL };
    const t0 = performance.now();
    const frame = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      }
      const ctx = canvas.getContext("2d");
      if (ctx && w && h) {
        cur = ease(cur, targetRef.current, 0.35);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawCharacter(ctx, w, h, shown, mode === "local" ? mirror(cur) : cur, (performance.now() - t0) / 1000);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [shown, mode]);

  return (
    <div data-testid={`character-${mode}`} data-character={shown ?? ""} style={{ position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none", opacity: shown ? 1 : 0, transition: "opacity 220ms ease" }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: shown ? "block" : "none", borderRadius: "inherit" }} />
    </div>
  );
}
