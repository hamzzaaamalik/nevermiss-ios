import { useLayoutEffect, useRef, useState } from "react";

// Rick's NeverMiss goodbye page (Oct 2026 design). Drawn at the size it
// was designed and scaled to fit the page, so it looks the same on both
// iPads and in one- and two-page view. The words are the design's own,
// not a book's stored sign-off text, so every book gets the new page
// without re-importing.
const W = 608;
const H = 765;

export function ClosingPage({ text, page }: { text: string; page: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    // The box's layout size: a page-turn animation transforms the page,
    // which would skew a measured-on-screen size.
    const fit = () => {
      const w = el.clientWidth, h = el.clientHeight;
      if (w > 0 && h > 0) setScale(Math.min(w / W, h / H));
    };
    fit();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);
  // The design's maroon and gold, lightened on a dark page (night light).
  const dark = luminance(page) < 0.35;
  const love = dark ? "#E7A9B3" : "#6B2D3D";
  const gold = dark ? "#D3B47A" : "#B8955A";
  const serif = "Merriweather, Georgia, 'Times New Roman', serif";
  return (
    <div ref={boxRef} data-testid="closing-page" style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden" }}>
      <div style={{
        position: "absolute", left: "50%", top: "50%", width: W, height: H,
        transform: `translate(-50%, -50%) scale(${scale})`,
        visibility: scale > 0 ? "visible" : "hidden",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        textAlign: "center", color: text, fontFamily: serif,
      }}>
        <div style={{ fontSize: 19, lineHeight: 1.4 }}>We hope you enjoyed your NeverMiss story.</div>
        <div style={{ fontSize: 19, lineHeight: 1.55, marginTop: 34 }}>
          The story may be over.<br />The time together is what matters.
        </div>
        <div aria-hidden style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 30, color: gold, fontSize: 18 }}>
          <span style={{ width: 84, height: 1, background: gold }} />
          <span style={{ fontSize: 15 }}>*</span>
          <span style={{ fontSize: 20, lineHeight: 1 }}>♥</span>
          <span style={{ fontSize: 15 }}>*</span>
          <span style={{ width: 84, height: 1, background: gold }} />
        </div>
        <div style={{ fontSize: 22, lineHeight: 1.4, marginTop: 30 }}>Reading Builds Literacy.</div>
        <div style={{ fontSize: 29, lineHeight: 1.3, marginTop: 18, fontWeight: 900, color: love }}>Reading Together Builds Love.</div>
        <div style={{ fontSize: 36, lineHeight: 1.2, marginTop: 52 }}>NeverMiss.</div>
        <div style={{ fontSize: 16.5, lineHeight: 1.45, marginTop: 14 }}>Never miss a story. Never miss a memory.</div>
        <div style={{ fontSize: 14, lineHeight: 1.45, marginTop: 12, opacity: 0.92 }}>Find more ways to read together and grow closer.</div>
        <div style={{ fontSize: 16, lineHeight: 1.45, marginTop: 8 }}>NeverMiss.Family</div>
        <div style={{ marginTop: 16, padding: 10, border: `1px solid ${dark ? "rgba(255,255,255,0.25)" : "#E6D7BC"}`, borderRadius: 4, background: dark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.35)" }}>
          <img data-testid="closing-qr" src="/nevermiss-heart-qr.png" alt="QR code for NeverMiss.Family" style={{ display: "block", width: 92, height: 92, imageRendering: "pixelated" }} />
        </div>
      </div>
    </div>
  );
}

/** 0 (black) to 1 (white) for a #rrggbb or rgb() colour. */
function luminance(color: string): number {
  let r = 1, g = 1, b = 1;
  const hex = color.trim().match(/^#([0-9a-f]{6})$/i);
  const rgb = color.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (hex) { const n = parseInt(hex[1], 16); r = (n >> 16) / 255; g = ((n >> 8) & 255) / 255; b = (n & 255) / 255; }
  else if (rgb) { r = +rgb[1] / 255; g = +rgb[2] / 255; b = +rgb[3] / 255; }
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
