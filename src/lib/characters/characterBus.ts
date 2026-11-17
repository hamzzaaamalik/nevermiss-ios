/**
 * Animated characters (Build 44, Rick's Animated Characters brief).
 *
 * Each iPad reads only its own face and sends a handful of numbers (how
 * open the mouth is, smile, blinks, brows, head turn) about 12 times a
 * second over the live call's message channel. The other iPad draws the
 * character from them. No picture of a face leaves the iPad and nothing
 * is stored.
 */

export type CharacterId = "lion" | "panda";
export const CHARACTERS: Array<{ id: CharacterId; label: string; emoji: string }> = [
  { id: "lion", label: "Lion", emoji: "🦁" },
  { id: "panda", label: "Panda", emoji: "🐼" },
];
export const isCharacterId = (v: unknown): v is CharacterId => v === "lion" || v === "panda";

/** Each 0..1, except yaw/pitch/roll in radians (head turn). */
export interface FaceExpr {
  jaw: number;
  smile: number;
  blinkL: number;
  blinkR: number;
  brow: number;
  pucker: number;
  yaw: number;
  pitch: number;
  roll: number;
  /** A face is in view. */
  seen: number;
}
export const NEUTRAL: FaceExpr = { jaw: 0, smile: 0.1, blinkL: 0, blinkR: 0, brow: 0, pucker: 0, yaw: 0, pitch: 0, roll: 0, seen: 0 };
const KEYS: Array<keyof FaceExpr> = ["jaw", "smile", "blinkL", "blinkR", "brow", "pucker", "yaw", "pitch", "roll", "seen"];

export interface CharMsg {
  t: "chr";
  ts: number;
  /** null: back to the camera. */
  c: CharacterId | null;
  /** The expression, packed (2 decimals). */
  e?: number[];
}
export const packExpr = (e: FaceExpr) => KEYS.map(k => Math.round(e[k] * 100) / 100);
export function unpackExpr(a: unknown): FaceExpr | null {
  if (!Array.isArray(a) || a.length !== KEYS.length || !a.every(n => typeof n === "number" && Number.isFinite(n))) return null;
  const out = { ...NEUTRAL };
  KEYS.forEach((k, i) => { out[k] = a[i] as number; });
  return out;
}
export function isCharMsg(v: unknown): v is CharMsg {
  const m = v as CharMsg | null;
  return !!m && m.t === "chr" && typeof m.ts === "number" && (m.c === null || isCharacterId(m.c));
}

type Listener = (m: CharMsg) => void;
let dailySend: ((m: CharMsg) => boolean) | null = null;
const listeners = new Set<Listener>();
let lastTs = 0;

export const characterBus = {
  /** Registered by the video layer while a call is joined. */
  setDailySender(fn: ((m: CharMsg) => boolean) | null) { dailySend = fn; },
  send(m: CharMsg) { try { dailySend?.(m); } catch { /* not joined */ } },
  receive(m: CharMsg) {
    if (m.ts < lastTs) return;
    lastTs = m.ts;
    for (const l of listeners) l(m);
  },
  subscribe(fn: Listener) { listeners.add(fn); return () => { listeners.delete(fn); }; },
};
