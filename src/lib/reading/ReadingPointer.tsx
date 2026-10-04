import { useEffect, useRef, useState, type RefObject } from "react";
import { pointerBus, type PointerMsg } from "./pointerBus";

/** Nana's own pointer, drawn locally without any network hop. */
type LocalListener = (m: PointerMsg) => void;
const localListeners = new Set<LocalListener>();
export const localPointer = {
  emit(m: PointerMsg) { for (const l of localListeners) l(m); },
  subscribe(fn: LocalListener) { localListeners.add(fn); return () => { localListeners.delete(fn); }; },
};

const FADE_AFTER_UP_MS = 2500;

function escapeAttr(v: string): string {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(v) : v.replace(/["\\]/g, "\\$&");
}

interface Resolved {
  tipX: number; tipY: number;
  line: { top: number; height: number; left: number; width: number } | null;
}

/** Where `m` points inside `area`, re-measured every frame so it follows
 *  this iPad's own layout. */
function resolve(area: HTMLElement, m: PointerMsg): Resolved {
  const a = area.getBoundingClientRect();
  if (m.wid) {
    const el = area.querySelector<HTMLElement>(`[data-wid="${escapeAttr(m.wid)}"]`);
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        let col = (el.closest(".book-body, .nm-book-body") as HTMLElement | null)?.getBoundingClientRect() ?? null;
        if (!col || col.width < 60) col = (el.closest(".nm-book-page") as HTMLElement | null)?.getBoundingClientRect() ?? null;
        const left = col ? col.left - a.left : r.left - a.left;
        const width = col ? col.width : r.width;
        return {
          tipX: r.left - a.left + (m.ox ?? 0.5) * r.width,
          tipY: r.top - a.top + (m.oy ?? 0.5) * r.height,
          line: { top: r.top - a.top, height: r.height, left, width },
        };
      }
    }
  }
  return { tipX: m.x * a.width, tipY: m.y * a.height, line: null };
}

/**
 * The reading pointer overlay inside the book area. `source` is "remote"
 * on the child's iPad (smoothed toward each update) and "local" on
 * Nana's (follows her finger exactly). Hidden while a word menu or a
 * phonics card is open so it never covers the letters being explained.
 */
export function ReadingPointerLayer({ areaRef, source, suppressed, page }: {
  areaRef: RefObject<HTMLDivElement | null>;
  source: "local" | "remote";
  suppressed: boolean;
  page: number;
}) {
  const [visible, setVisible] = useState(false);
  const [style, setStyle] = useState<"finger" | "ruler">("finger");
  const handRef = useRef<HTMLDivElement>(null);
  const bandRef = useRef<HTMLDivElement>(null);
  const msgRef = useRef<PointerMsg | null>(null);
  const curRef = useRef<{ x: number; y: number } | null>(null);
  const fadeRef = useRef<number | null>(null);
  const pageRef = useRef(page);
  pageRef.current = page;

  useEffect(() => {
    const on = (m: PointerMsg) => {
      // An update from before a page turn points at words that are gone.
      if (m.page !== pageRef.current && m.phase === "move") return;
      msgRef.current = m;
      setStyle(m.style);
      if (fadeRef.current !== null) { window.clearTimeout(fadeRef.current); fadeRef.current = null; }
      if (m.phase === "move") {
        setVisible(true);
      } else {
        fadeRef.current = window.setTimeout(() => { setVisible(false); curRef.current = null; }, FADE_AFTER_UP_MS);
      }
    };
    const off = source === "remote" ? pointerBus.subscribe(on) : localPointer.subscribe(on);
    return () => { off(); if (fadeRef.current !== null) window.clearTimeout(fadeRef.current); };
  }, [source]);

  // A page turn clears the pointer (its word is gone).
  useEffect(() => { setVisible(false); curRef.current = null; msgRef.current = null; }, [page]);

  useEffect(() => {
    if (!visible) return;
    let raf = 0;
    const tick = () => {
      const area = areaRef.current;
      const m = msgRef.current;
      if (area && m) {
        const r = resolve(area, m);
        const k = source === "remote" ? 0.35 : 1;
        const cur = curRef.current ?? { x: r.tipX, y: r.tipY };
        cur.x += (r.tipX - cur.x) * k;
        cur.y += (r.tipY - cur.y) * k;
        curRef.current = cur;
        if (handRef.current) {
          handRef.current.style.transform = `translate(${cur.x}px, ${cur.y}px)`;
        }
        if (bandRef.current) {
          const b = bandRef.current.style;
          if (r.line) {
            b.left = `${r.line.left - 8}px`;
            b.width = `${r.line.width + 16}px`;
            b.top = `${r.line.top - 5}px`;
            b.height = `${r.line.height + 10}px`;
          } else {
            // Between lines or in the margin: no band (it snaps to lines).
            b.width = "0px";
            b.height = "0px";
          }
          b.opacity = r.line ? "1" : "0";
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [visible, areaRef, source, style]);

  const show = visible && !suppressed;
  return (
    <div aria-hidden data-testid={`reading-pointer-${source}`} data-visible={show ? "1" : "0"} data-style={style}
      style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 25, opacity: show ? 1 : 0, transition: "opacity 260ms ease", overflow: "hidden" }}>
      {style === "ruler" ? (
        <div ref={bandRef} style={{
          position: "absolute", left: 0, top: 0, width: 0, height: 0,
          borderRadius: 8,
          background: "rgba(201,146,42,0.10)",
          borderTop: "2px solid rgba(201,146,42,0.45)",
          borderBottom: "2px solid rgba(201,146,42,0.45)",
          boxShadow: "0 0 0 4000px rgba(10,15,30,0.10)",
          transition: source === "remote" ? "top 120ms ease, height 120ms ease, left 120ms ease, width 120ms ease" : undefined,
        }} />
      ) : (
        <div ref={handRef} style={{ position: "absolute", left: 0, top: 0, willChange: "transform" }}>
          {/* Bold dark arrow; its tip sits exactly on the point. */}
          <svg width="44" height="56" viewBox="0 0 20 26" style={{ display: "block", filter: "drop-shadow(0 3px 6px rgba(0,0,0,0.45))" }}>
            <path d="M1 1 L1 20.5 L6 15.8 L9.6 24.4 L13.2 22.9 L9.7 14.5 L16.4 14.5 Z" fill="#1B2B4B" stroke="#ffffff" strokeWidth="1.7" strokeLinejoin="round" />
          </svg>
        </div>
      )}
    </div>
  );
}
