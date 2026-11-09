/**
 * "How NeverMiss looks": Nana picks the colours and the Library style.
 * Used in Settings (wide) and in the Menu's "Colours & Library" panel (narrow).
 * Big, labelled choices; each colour card shows a small preview of that look.
 */
import type { CSSProperties } from "react";
import { LIBRARY_STYLES, LIBRARY_STYLE_META, LOOK_IDS, LOOK_META, lookSwatch, type LibraryStyle, type LookId } from "./looks";

const FONT = "DM Sans, sans-serif";

function Check() {
  return (
    <span aria-hidden style={{
      position: "absolute", top: 8, right: 8, width: 26, height: 26, borderRadius: "50%",
      background: "var(--lk-accent, #C9922A)", color: "var(--lk-navy, #1B2B4B)",
      display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 900,
      boxShadow: "0 2px 8px var(--lk-shadow-350, rgba(0,0,0,0.35))",
    }}>✓</span>
  );
}

/** A tiny screen in a look's own colours: a top bar, a gold button and two book rows. */
export function Preview({ look }: { look: LookId }) {
  const c = lookSwatch(look);
  return (
    <span aria-hidden style={{ display: "block", height: 74, borderRadius: 10, background: c.bg, border: `1px solid ${c.line}`, padding: 8, overflow: "hidden" }}>
      <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ width: 34, height: 5, borderRadius: 3, background: c.ink, opacity: 0.85 }} />
        <span style={{ width: 22, height: 9, borderRadius: 5, background: `linear-gradient(135deg, ${c.accentHi}, ${c.accent})` }} />
      </span>
      {[0, 1].map(i => (
        <span key={i} style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 7, padding: 4, borderRadius: 6, background: c.raised, border: `1px solid ${c.line}` }}>
          <span style={{ width: 11, height: 14, borderRadius: 2, background: i ? "#2F5D46" : "#8A3B52" }} />
          <span style={{ flex: 1, height: 4, borderRadius: 2, background: c.ink, opacity: 0.55 }} />
        </span>
      ))}
    </span>
  );
}

/** A drawing of a Library style, in the current look's colours. */
export function StyleSketch({ style }: { style: LibraryStyle }) {
  const cover = (h: number, bg: string) => <span style={{ width: h * 0.75, height: h, borderRadius: 2, background: bg, flex: "none" }} />;
  const ink: CSSProperties = { height: 4, borderRadius: 2, background: "var(--lk-ink-450, rgba(247,240,227,0.45))" };
  const box: CSSProperties = { width: 86, height: 58, flex: "none", borderRadius: 8, padding: 6, overflow: "hidden", background: "var(--lk-fill-060, rgba(255,255,255,0.06))", border: "1px solid var(--lk-line-120, rgba(255,255,255,0.12))", display: "flex", flexDirection: "column", gap: 4 };
  if (style === "shelf") return (
    <span aria-hidden style={box}>
      {[0, 1].map(r => (
        <span key={r} style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ display: "flex", gap: 3, alignItems: "flex-end", padding: "0 2px" }}>{cover(16, "#8A3B52")}{cover(16, "#1F4E79")}{cover(16, "#2F5D46")}{cover(16, "#A5562F")}</span>
          <span style={{ height: 3, borderRadius: 1, background: "var(--lk-shelf, #6A5138)" }} />
        </span>
      ))}
    </span>
  );
  if (style === "storefront") return (
    <span aria-hidden style={box}>
      <span style={{ display: "flex", gap: 5, alignItems: "center", padding: 3, borderRadius: 5, background: "var(--lk-fill-080, rgba(255,255,255,0.08))" }}>{cover(22, "#1F4E79")}<span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}><span style={ink} /><span style={{ ...ink, width: "60%", background: "var(--lk-accent, #C9922A)" }} /></span></span>
      <span style={{ display: "flex", gap: 3 }}>{cover(14, "#8A3B52")}{cover(14, "#2F5D46")}{cover(14, "#A5562F")}{cover(14, "#5F6B2E")}</span>
    </span>
  );
  if (style === "list") return (
    <span aria-hidden style={box}>
      {["#8A3B52", "#1F4E79", "#2F5D46"].map(bg => (
        <span key={bg} style={{ display: "flex", gap: 5, alignItems: "center", paddingBottom: 2, borderBottom: "1px solid var(--lk-line-080, rgba(255,255,255,0.08))" }}>{cover(12, bg)}<span style={{ ...ink, flex: 1 }} /></span>
      ))}
    </span>
  );
  return (
    <span aria-hidden style={box}>
      {["#8A3B52", "#1F4E79", "#2F5D46"].map(bg => (
        <span key={bg} style={{ display: "flex", gap: 4, alignItems: "center", padding: 2, borderRadius: 4, borderLeft: `3px solid ${bg}`, background: "var(--lk-fill-060, rgba(255,255,255,0.06))" }}><span style={{ width: 8, height: 8, borderRadius: 2, background: bg }} /><span style={{ ...ink, flex: 1 }} /></span>
      ))}
    </span>
  );
}

export function LookPicker({ look, style, onChoose, narrow = false }: {
  look: LookId;
  style: LibraryStyle;
  onChoose: (next: { look?: LookId; style?: LibraryStyle }) => void;
  /** The Menu panel: two colour cards a row instead of three. */
  narrow?: boolean;
}) {
  const heading: CSSProperties = { margin: "0 0 8px", color: "var(--lk-ink-720, rgba(247,240,227,0.72))", fontFamily: FONT, fontSize: 13, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase" };
  return (
    <div data-testid="look-picker" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <p style={heading}>Colours</p>
        <div role="radiogroup" aria-label="Colours" style={{ display: "grid", gridTemplateColumns: `repeat(${narrow ? 2 : 3}, minmax(0, 1fr))`, gap: 10 }}>
          {LOOK_IDS.map(id => {
            const on = id === look;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={on}
                data-look={id}
                onClick={() => onChoose({ look: id })}
                style={{
                  position: "relative", textAlign: "left", padding: 8, minHeight: 64, borderRadius: 14, cursor: "pointer", touchAction: "manipulation",
                  background: on ? "var(--lk-accent-120, rgba(201,146,42,0.12))" : "var(--lk-fill-040, rgba(255,255,255,0.04))",
                  border: on ? "3px solid var(--lk-accent, #C9922A)" : "1px solid var(--lk-line-140, rgba(255,255,255,0.14))",
                }}
              >
                <Preview look={id} />
                <span style={{ display: "block", marginTop: 7, color: "var(--lk-ink, #F7F0E3)", fontFamily: FONT, fontSize: 16, fontWeight: 800 }}>{LOOK_META[id].name}</span>
                {LOOK_META[id].recommended && <span style={{ display: "block", color: "var(--lk-accent-t, #C9922A)", fontFamily: FONT, fontSize: 12, fontWeight: 700 }}>Suggested</span>}
                {on && <Check />}
              </button>
            );
          })}
        </div>
        <p style={{ margin: "8px 2px 0", color: "var(--lk-ink-720, rgba(247,240,227,0.72))", fontFamily: FONT, fontSize: 14, lineHeight: 1.45 }}>{LOOK_META[look].say}</p>
      </div>
      <div>
        <p style={heading}>Library</p>
        <div role="radiogroup" aria-label="Library style" style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 10 }}>
          {LIBRARY_STYLES.map(id => {
            const on = id === style;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={on}
                data-library-style={id}
                onClick={() => onChoose({ style: id })}
                style={{
                  position: "relative", display: "flex", alignItems: "center", gap: 12, textAlign: "left", padding: "10px 40px 10px 10px", minHeight: 64,
                  borderRadius: 14, cursor: "pointer", touchAction: "manipulation",
                  background: on ? "var(--lk-accent-120, rgba(201,146,42,0.12))" : "var(--lk-fill-040, rgba(255,255,255,0.04))",
                  border: on ? "3px solid var(--lk-accent, #C9922A)" : "1px solid var(--lk-line-140, rgba(255,255,255,0.14))",
                }}
              >
                <StyleSketch style={id} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", color: "var(--lk-ink, #F7F0E3)", fontFamily: FONT, fontSize: 16, fontWeight: 800 }}>
                    {LIBRARY_STYLE_META[id].name}
                    {id === "shelf" && <span style={{ marginLeft: 8, color: "var(--lk-accent-t, #C9922A)", fontSize: 12, fontWeight: 700 }}>Suggested</span>}
                  </span>
                  <span style={{ display: "block", marginTop: 2, color: "var(--lk-ink-720, rgba(247,240,227,0.72))", fontFamily: FONT, fontSize: 13, lineHeight: 1.35 }}>{LIBRARY_STYLE_META[id].say}</span>
                </span>
                {on && <Check />}
              </button>
            );
          })}
        </div>
      </div>
      <p style={{ margin: 0, color: "var(--lk-ink-600, rgba(247,240,227,0.6))", fontFamily: FONT, fontSize: 13, lineHeight: 1.45 }}>
        Both iPads change together. The book pages keep their own Day, White, Sepia or Night light.
      </p>
    </div>
  );
}
