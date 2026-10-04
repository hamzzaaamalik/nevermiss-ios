/**
 * Reading pointer transport (Rick's Reading Pointer spec, Oct 1 2026).
 *
 * Nana's finger position travels over the live video connection (Daily
 * app messages, ~22 per second) and, as a backstop, over the session
 * stream (~5 per second). The child's iPad keeps whichever copy is
 * newest. Positions are anchored to a word id plus an offset inside that
 * word, with a page-relative fallback, so the pointer lands on the same
 * text on an iPad mini and an iPad Pro.
 */

export type PointerStyle = "finger" | "ruler";

export interface PointerMsg {
  t: "ptr";
  /** Sender clock; receivers ignore anything older than what they have. */
  ts: number;
  phase: "move" | "up";
  style: PointerStyle;
  /** Word under the pointer tip, when there is one. */
  wid?: string;
  /** Offset inside that word's box, 0..1. */
  ox?: number;
  oy?: number;
  /** Book-area-relative fallback position, 0..1. */
  x: number;
  y: number;
  /** Source page the book was on, to drop stale messages after a turn. */
  page: number;
}

type Listener = (m: PointerMsg) => void;

let dailySend: ((m: PointerMsg) => boolean) | null = null;
let sseSend: ((m: PointerMsg) => void) | null = null;
const listeners = new Set<Listener>();
let lastSseAt = 0;
let lastTs = 0;

const SSE_MIN_MS = 200;

export function isPointerMsg(v: unknown): v is PointerMsg {
  const m = v as PointerMsg | null;
  return !!m && m.t === "ptr" && typeof m.ts === "number" && typeof m.x === "number" && typeof m.y === "number";
}

export const pointerBus = {
  /** Registered by the video layer while a Daily call is joined. */
  setDailySender(fn: ((m: PointerMsg) => boolean) | null) { dailySend = fn; },
  /** Registered by the app for the session-stream backstop. */
  setSseSender(fn: ((m: PointerMsg) => void) | null) { sseSend = fn; },

  /** Nana's iPad: send one pointer update on every path available. */
  send(m: PointerMsg) {
    let viaDaily = false;
    try { viaDaily = dailySend ? dailySend(m) : false; } catch { viaDaily = false; }
    const now = Date.now();
    // The stream backstop is capped at ~5 per second either way (it is a
    // server round trip each); the lift always goes out.
    void viaDaily;
    if (m.phase === "up" || now - lastSseAt >= SSE_MIN_MS) {
      lastSseAt = now;
      try { sseSend?.(m); } catch {}
    }
  },

  /** Child's iPad: feed an incoming message from either path. */
  receive(v: unknown) {
    if (!isPointerMsg(v)) return;
    // A much older stamp means a different sender clock (Nana switched
    // iPads, or her clock was corrected): start over from it.
    if (v.ts < lastTs - 30_000) lastTs = 0;
    if (v.ts < lastTs || (v.ts === lastTs && v.phase !== "up")) return;
    lastTs = v.ts;
    for (const l of listeners) l(v);
  },

  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
};
