import { useEffect, useState } from "react";

/**
 * A hidden frame meter for checking smoothness on a real iPad (TestFlight),
 * where there is no Mac to inspect the page. Five quick taps on the
 * NeverMiss name in the top bar switch it on or off; the choice is kept on
 * this iPad. It shows frames per second, the slowest frame and how many
 * frames took longer than about two frames (34 ms) in each second.
 */
const KEY = "nm_fps";
const EVENT = "nm-fps-toggle";

export function fpsMeterOn(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}

let taps: number[] = [];
export function tapForFpsMeter(): void {
  const now = Date.now();
  taps = taps.filter(t => now - t < 2500);
  taps.push(now);
  if (taps.length < 5) return;
  taps = [];
  try { localStorage.setItem(KEY, fpsMeterOn() ? "0" : "1"); } catch { /* private mode */ }
  window.dispatchEvent(new Event(EVENT));
}

export function FpsMeter() {
  const [on, setOn] = useState(fpsMeterOn);
  const [stats, setStats] = useState({ fps: 0, worst: 0, slow: 0 });

  useEffect(() => {
    const sync = () => setOn(fpsMeterOn());
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);

  useEffect(() => {
    if (!on) return;
    let raf = 0;
    let last = performance.now();
    let windowStart = last;
    let frames = 0, worst = 0, slow = 0;
    const loop = (t: number) => {
      const dt = t - last;
      last = t;
      frames++;
      if (dt > worst) worst = dt;
      if (dt > 34) slow++;
      if (t - windowStart >= 1000) {
        setStats({ fps: Math.round((frames * 1000) / (t - windowStart)), worst: Math.round(worst), slow });
        frames = 0; worst = 0; slow = 0; windowStart = t;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [on]);

  if (!on) return null;
  const bad = stats.slow > 2 || stats.fps < 50;
  return (
    <div
      data-testid="fps-meter"
      aria-hidden
      style={{
        position: "fixed", left: 8, bottom: 8, zIndex: 2147483000, pointerEvents: "none",
        padding: "4px 8px", borderRadius: 8,
        background: bad ? "rgba(185,28,28,0.85)" : "rgba(15,23,42,0.8)",
        color: "#fff", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11, lineHeight: 1.3,
      }}
    >
      {stats.fps} fps · slowest {stats.worst} ms · slow {stats.slow}
    </div>
  );
}
