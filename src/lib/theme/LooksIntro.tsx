/**
 * The one-time "NeverMiss has a new look" card on Nana's Home (Build 43).
 * Shown once, on an iPad that used NeverMiss before looks existed. Nana can
 * keep the new look, see all the looks, or go back to the look she had
 * (Midnight with the Classic list). Every choice is saved for both iPads.
 */
import { useState } from "react";
import { chooseFamilyLook } from "./familyLook";
import { finishLooksIntro, looksIntroPending, type LibraryStyle, type LookId } from "./looks";
import { LookPicker, Preview, StyleSketch } from "./LookPicker";
import { useLooks } from "./useLooks";

const FONT = "DM Sans, sans-serif";

export function LooksIntro() {
  const [open, setOpen] = useState(looksIntroPending);
  const [choosing, setChoosing] = useState(false);
  const { look, style } = useLooks();
  if (!open) return null;
  const finish = (next: { look: LookId; style: LibraryStyle }) => {
    void chooseFamilyLook(next);
    finishLooksIntro();
    setOpen(false);
  };
  const pill = (primary: boolean) => ({
    display: "block", width: "100%", minHeight: 56, borderRadius: 999, cursor: "pointer", touchAction: "manipulation" as const,
    fontFamily: FONT, fontSize: 18, fontWeight: 800,
    border: primary ? "none" : "2px solid var(--lk-accent-550, rgba(201,146,42,0.55))",
    background: primary ? "linear-gradient(135deg, var(--lk-accent-hi, #f7c95d) 0%, var(--lk-accent, #C9922A) 55%, var(--lk-accent-2, #d97706) 100%)" : "transparent",
    color: primary ? "var(--lk-navy, #1B2B4B)" : "var(--lk-accent-t, #C9922A)",
  });
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 90, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "var(--lk-deep-720, rgba(8,15,30,0.72))" }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="looks-intro-title"
        data-testid="looks-intro"
        style={{
          width: choosing ? "min(760px, 100%)" : "min(520px, 100%)", maxHeight: "100%", overflowY: "auto",
          padding: "26px 26px 22px", borderRadius: 24,
          background: "var(--lk-row, #131F35)", border: "1px solid var(--lk-accent-350, rgba(201,146,42,0.35))",
          boxShadow: "0 24px 60px var(--lk-shadow-550, rgba(0,0,0,0.55))",
        }}
      >
        <h2 id="looks-intro-title" style={{ margin: 0, textAlign: "center", fontFamily: "Playfair Display, Georgia, serif", fontSize: 28, fontWeight: 700, color: "var(--lk-strong, #FFFFFF)" }}>
          NeverMiss has a new look
        </h2>
        {!choosing ? (
          <>
            <p style={{ margin: "10px 0 0", textAlign: "center", fontFamily: FONT, fontSize: 17, lineHeight: 1.5, color: "var(--lk-ink-850, rgba(247,240,227,0.85))" }}>
              Warm cream pages, with your books standing on a bookshelf. It changes on both iPads.
            </p>
            <div style={{ display: "flex", gap: 14, justifyContent: "center", alignItems: "center", margin: "18px 0 20px" }}>
              <span style={{ width: 150 }}><Preview look={look} /></span>
              <StyleSketch style={style} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button type="button" data-testid="looks-intro-keep" style={pill(true)} onClick={() => finish({ look, style })}>Keep the new look</button>
              <button type="button" data-testid="looks-intro-choose" style={pill(false)} onClick={() => setChoosing(true)}>See all the looks</button>
              <button
                type="button"
                data-testid="looks-intro-old"
                onClick={() => finish({ look: "midnight", style: "today" })}
                style={{ minHeight: 48, background: "none", border: "none", cursor: "pointer", fontFamily: FONT, fontSize: 16, fontWeight: 700, color: "var(--lk-ink-720, rgba(247,240,227,0.72))", textDecoration: "underline" }}
              >
                Go back to the look I had
              </button>
            </div>
            <p style={{ margin: "10px 0 0", textAlign: "center", fontFamily: FONT, fontSize: 14, color: "var(--lk-ink-600, rgba(247,240,227,0.6))" }}>
              You can change it any time: Menu, then Colours &amp; Library.
            </p>
          </>
        ) : (
          <>
            <div style={{ marginTop: 16 }}>
              <LookPicker look={look} style={style} onChoose={next => { void chooseFamilyLook(next); }} />
            </div>
            <button type="button" data-testid="looks-intro-done" style={{ ...pill(true), marginTop: 16 }} onClick={() => finish({ look, style })}>Done</button>
          </>
        )}
      </div>
    </div>
  );
}
