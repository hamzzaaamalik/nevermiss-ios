import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, ApiError, type StoreBook, type StorePage } from "../api";
import { BookCover } from "../library/LibraryStyles";

/**
 * The Book Store on Nana's iPad (Build 44): books from NeverMiss authors.
 * Free ones are already in every family's Library; paid ones show a price,
 * a free sample and "Buy". Buying asks a quick grown-up question (Apple's
 * rule for apps made for kids), then opens Stripe's own page in Safari.
 * The book unlocks only when Stripe confirms the payment, and then it's in
 * the Library on both iPads, in every one of Nana's homes.
 */

const FONT = "DM Sans, sans-serif";
const SERIF = "Playfair Display, serif";
const INK = "var(--lk-ink, #F7F0E3)";
const STRONG = "var(--lk-strong, #F7F0E3)";
const MUTED = "var(--lk-ink-650, rgba(247,240,227,0.65))";
const ACCENT = "var(--lk-accent, #C9922A)";
const ACCENT_T = "var(--lk-accent-t, #C9922A)";
const NAVY = "var(--lk-navy, #1B2B4B)";
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const AGE_LABEL: Record<string, string> = { "4-5": "Ages 4–5", "5-7": "Ages 5–7", "7-10": "Ages 7–10", "10-13": "Ages 10–13" };

type Buying = { book: StoreBook; purchaseId: string; status: "waiting" | "paid" | "failed" };

export function BookStore({ connectionId, onClose, onReadNow }: {
  connectionId: string | null;
  onClose: () => void;
  /** The book is in the Library now: open it there. */
  onReadNow: (bookId: string) => void;
}) {
  const [books, setBooks] = useState<StoreBook[] | null>(null);
  const [error, setError] = useState("");
  const [age, setAge] = useState<string>("all");
  const [detail, setDetail] = useState<StoreBook | null>(null);
  const [sample, setSample] = useState<{ book: StoreBook; pages: StorePage[] } | null>(null);
  const [gate, setGate] = useState<StoreBook | null>(null);
  const [buying, setBuying] = useState<Buying | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.store.books()
      .then(r => { setBooks(r.books); setError(""); })
      .catch(e => setError(e instanceof ApiError ? e.message : "The Book Store couldn't load. Check that this iPad is online."));
  }, []);
  useEffect(() => { load(); }, [load]);

  // Stripe's confirmation arrives on the live stream ("book_unlocked");
  // checking every few seconds covers a stream that missed it.
  const buyingRef = useRef(buying);
  buyingRef.current = buying;
  useEffect(() => {
    if (!buying || buying.status !== "waiting") return;
    const check = async () => {
      const b = buyingRef.current;
      if (!b || b.status !== "waiting") return;
      try {
        const r = await api.store.purchase(b.purchaseId);
        if (r.status === "paid") { setBuying({ ...b, status: "paid" }); load(); }
        else if (r.status === "failed" || r.status === "expired") setBuying({ ...b, status: "failed" });
      } catch { /* try again */ }
    };
    const t = window.setInterval(() => void check(), 3000);
    const onUnlock = (e: Event) => { if ((e as CustomEvent).detail?.bookId === buying.book.id) void check(); };
    const onFocus = () => void check();
    window.addEventListener("nm-book-unlocked", onUnlock);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => { window.clearInterval(t); window.removeEventListener("nm-book-unlocked", onUnlock); window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onFocus); };
  }, [buying, load]);

  const ages = useMemo(() => Array.from(new Set((books ?? []).map(b => b.ageTier).filter(Boolean) as string[])).sort((a, b) => parseInt(a) - parseInt(b)), [books]);
  const shown = (books ?? []).filter(b => age === "all" || b.ageTier === age);

  const openSample = async (b: StoreBook) => {
    setBusy(true);
    try { const r = await api.store.sample(b.id); setSample({ book: b, pages: r.book.pages }); }
    catch (e) { setError(e instanceof ApiError ? e.message : "The sample couldn't load."); }
    finally { setBusy(false); }
  };
  const startCheckout = async (b: StoreBook) => {
    setGate(null);
    setBusy(true);
    try {
      const r = await api.store.checkout(b.id, connectionId);
      setBuying({ book: b, purchaseId: r.purchaseId, status: "waiting" });
      // Stripe's page opens in Safari; iOS shows "◀ NeverMiss" to come back.
      window.open(r.url, "_blank");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The payment page couldn't open. Try again.");
    } finally { setBusy(false); }
  };

  return createPortal(
    <div data-testid="book-store" role="dialog" aria-label="Book Store" style={{
      position: "fixed", inset: 0, zIndex: 9000, display: "flex", flexDirection: "column",
      background: "var(--lk-bg, #0b172e)",
      backgroundImage: "radial-gradient(900px 520px at 50% -10%, var(--lk-accent-hi-160, rgba(247,201,93,0.16)), transparent 70%)",
      fontFamily: FONT, color: INK, animation: "fade-in 0.2s ease-out",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 20px", borderBottom: "1px solid var(--lk-line-100, rgba(255,255,255,0.1))" }}>
        <button type="button" data-testid="store-close" onClick={onClose} style={{
          minHeight: 48, padding: "0 18px", borderRadius: 999, cursor: "pointer", touchAction: "manipulation",
          background: "var(--lk-fill-060, rgba(255,255,255,0.06))", border: "1.5px solid var(--lk-line-250, rgba(255,255,255,0.25))",
          color: INK, fontFamily: FONT, fontSize: 17, fontWeight: 700,
        }}>← Library</button>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: SERIF, fontSize: 28, fontWeight: 700, color: STRONG, lineHeight: 1.1 }}>Find a New Book</div>
          <div style={{ color: MUTED, fontSize: 14, fontWeight: 600 }}>Books from NeverMiss authors · Only on Nana's iPad</div>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "18px 22px 40px" }}>
        {error && <div role="alert" style={{ marginBottom: 14, padding: "12px 16px", borderRadius: 14, background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.4)", color: "var(--lk-bad-t, #fca5a5)", fontSize: 16 }}>{error}</div>}
        {!books && !error && <div style={{ color: MUTED, fontSize: 18, padding: 40, textAlign: "center" }}>Opening the Book Store…</div>}
        {books && books.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 20px" }}>
            <div style={{ fontFamily: SERIF, fontSize: 28, color: STRONG }}>New books are on their way</div>
            <div style={{ color: MUTED, fontSize: 17, marginTop: 8 }}>Books from NeverMiss authors will appear here soon.</div>
          </div>
        )}
        {books && books.length > 0 && (
          <>
            {ages.length > 1 && (
              <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
                {["all", ...ages].map(a => (
                  <button key={a} type="button" onClick={() => setAge(a)} style={{
                    minHeight: 44, padding: "0 18px", borderRadius: 999, cursor: "pointer", touchAction: "manipulation",
                    background: age === a ? ACCENT : "var(--lk-fill-060, rgba(255,255,255,0.06))",
                    border: `1.5px solid ${age === a ? ACCENT : "var(--lk-line-200, rgba(255,255,255,0.2))"}`,
                    color: age === a ? NAVY : INK, fontFamily: FONT, fontSize: 16, fontWeight: 700,
                  }}>{a === "all" ? "✨ All" : AGE_LABEL[a] ?? a}</button>
                ))}
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 26 }}>
              {shown.map(b => (
                <button key={b.id} type="button" data-testid={`store-book-${b.id}`} onClick={() => setDetail(b)} style={{
                  background: "none", border: "none", padding: 0, cursor: "pointer", touchAction: "manipulation", textAlign: "left",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 10, color: INK,
                }}>
                  <BookCover book={{ id: b.id, title: b.title, author: b.author, emoji: b.emoji, spineColor: b.spineColor, pages: [], coverThumbUrl: b.cover ?? undefined }} width={150} height={200} />
                  <div style={{ width: "100%", textAlign: "center" }}>
                    <div style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 700, color: STRONG, lineHeight: 1.2 }}>{b.title}</div>
                    <div style={{ color: MUTED, fontSize: 14, marginTop: 2 }}>{b.author}</div>
                    <div style={{ marginTop: 6, fontSize: 15, fontWeight: 800, color: b.owned ? "var(--lk-ok-t, #86efac)" : ACCENT_T }}>
                      {b.owned ? (b.priceCents ? "✓ In your Library" : "Free · In your Library") : money(b.priceCents)}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {detail && !buying && (
        <Sheet onClose={() => setDetail(null)} testId="store-detail">
          <div style={{ display: "flex", gap: 26, flexWrap: "wrap" }}>
            <BookCover book={{ id: detail.id, title: detail.title, author: detail.author, emoji: detail.emoji, spineColor: detail.spineColor, pages: [], coverThumbUrl: detail.cover ?? undefined }} width={200} height={268} />
            <div style={{ flex: "1 1 300px", minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontFamily: SERIF, fontSize: 32, fontWeight: 700, color: STRONG, lineHeight: 1.1 }}>{detail.title}</div>
              <div style={{ color: MUTED, fontSize: 17 }}>by {detail.author}{detail.ageTier ? ` · ${AGE_LABEL[detail.ageTier] ?? detail.ageTier}` : ""} · {detail.pageCount} pages</div>
              {detail.tagline && <div style={{ fontSize: 18, lineHeight: 1.55, color: INK }}>{detail.tagline}</div>}
              {detail.authorBio && <div style={{ fontSize: 15, lineHeight: 1.5, color: MUTED }}><b style={{ color: INK }}>About {detail.author}:</b> {detail.authorBio}</div>}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
                {detail.owned ? (
                  <BigButton testId="store-read-now" onClick={() => onReadNow(detail.id)}>Read Now</BigButton>
                ) : (
                  <>
                    <BigButton testId="store-buy" onClick={() => setGate(detail)} disabled={busy}>Buy for {money(detail.priceCents)}</BigButton>
                    {detail.samplePages > 0 && <BigButton testId="store-sample" ghost onClick={() => void openSample(detail)} disabled={busy}>Free sample</BigButton>}
                  </>
                )}
              </div>
              <div style={{ color: MUTED, fontSize: 15, marginTop: 4 }}>
                {detail.owned ? "It's in your Library on both iPads." : "Your whole family can read it, in every home, on both iPads."}
              </div>
            </div>
          </div>
        </Sheet>
      )}

      {sample && (
        <Sheet onClose={() => setSample(null)} testId="store-sample-view" wide>
          <div style={{ fontFamily: SERIF, fontSize: 24, color: STRONG, marginBottom: 12 }}>A free sample of {sample.book.title}</div>
          <SamplePages pages={sample.pages} />
          {!sample.book.owned && (
            <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
              <BigButton onClick={() => { const b = sample.book; setSample(null); setGate(b); }}>Buy for {money(sample.book.priceCents)}</BigButton>
            </div>
          )}
        </Sheet>
      )}

      {gate && <GrownUpGate onPass={() => void startCheckout(gate)} onCancel={() => setGate(null)} />}

      {buying && (
        <Sheet onClose={() => { if (buying.status !== "waiting") setBuying(null); }} testId="store-buying">
          {buying.status === "waiting" && (
            <div style={{ textAlign: "center", padding: "10px 6px" }}>
              <div style={{ fontFamily: SERIF, fontSize: 28, color: STRONG }}>Finish paying in Safari</div>
              <div style={{ fontSize: 18, lineHeight: 1.55, color: INK, marginTop: 10 }}>
                Stripe's secure page is open in Safari. When you're done, tap <b>◀ NeverMiss</b> at the top left to come back here.
              </div>
              <div style={{ color: MUTED, fontSize: 15, marginTop: 10 }}>Your book appears here as soon as the payment is confirmed.</div>
              <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 18, flexWrap: "wrap" }}>
                <BigButton ghost onClick={() => { void startCheckout(buying.book); }}>Open the payment page again</BigButton>
                <BigButton ghost onClick={() => setBuying(null)}>Cancel</BigButton>
              </div>
            </div>
          )}
          {buying.status === "paid" && (
            <div data-testid="store-paid" style={{ textAlign: "center", padding: "10px 6px" }}>
              <div style={{ fontSize: 46 }}>🎉</div>
              <div style={{ fontFamily: SERIF, fontSize: 30, color: STRONG }}>It's yours!</div>
              <div style={{ fontSize: 18, lineHeight: 1.55, color: INK, marginTop: 8 }}><i>{buying.book.title}</i> is in your Library now, on both iPads.</div>
              <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 18 }}>
                <BigButton testId="store-read-now" onClick={() => onReadNow(buying.book.id)}>Read Now</BigButton>
              </div>
            </div>
          )}
          {buying.status === "failed" && (
            <div style={{ textAlign: "center", padding: "10px 6px" }}>
              <div style={{ fontFamily: SERIF, fontSize: 28, color: STRONG }}>The payment didn't go through</div>
              <div style={{ fontSize: 18, color: INK, marginTop: 8 }}>No money was taken. You can try again.</div>
              <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 18 }}>
                <BigButton onClick={() => { const b = buying.book; setBuying(null); setGate(b); }}>Try again</BigButton>
                <BigButton ghost onClick={() => setBuying(null)}>Close</BigButton>
              </div>
            </div>
          )}
        </Sheet>
      )}
    </div>,
    document.body,
  );
}

function BigButton({ children, onClick, ghost, disabled, testId }: { children: React.ReactNode; onClick: () => void; ghost?: boolean; disabled?: boolean; testId?: string }) {
  return (
    <button type="button" data-testid={testId} onClick={onClick} disabled={disabled} style={{
      minHeight: 58, padding: "0 28px", borderRadius: 999, cursor: disabled ? "default" : "pointer", touchAction: "manipulation",
      background: ghost ? "var(--lk-fill-060, rgba(255,255,255,0.06))" : "linear-gradient(135deg, var(--lk-accent-hi, #f7c95d) 0%, var(--lk-accent, #C9922A) 60%, var(--lk-accent-2, #d97706) 100%)",
      border: ghost ? "1.5px solid var(--lk-line-250, rgba(255,255,255,0.25))" : "none",
      color: ghost ? INK : NAVY, fontFamily: FONT, fontSize: 19, fontWeight: 800, opacity: disabled ? 0.6 : 1,
      boxShadow: ghost ? "none" : "0 8px 22px var(--lk-accent-450, rgba(201,146,42,0.45))",
    }}>{children}</button>
  );
}

function Sheet({ children, onClose, testId, wide }: { children: React.ReactNode; onClose: () => void; testId?: string; wide?: boolean }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9100, background: "var(--lk-deep-720, rgba(8,15,30,0.72))", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div data-testid={testId} role="dialog" onClick={e => e.stopPropagation()} style={{
        position: "relative", width: wide ? "min(900px, 100%)" : "min(760px, 100%)", maxHeight: "92%", overflowY: "auto",
        background: "var(--lk-n-0f1d36, #0f1d36)", border: "1px solid var(--lk-accent-450, rgba(201,146,42,0.45))",
        borderRadius: 26, padding: "28px 28px 26px", boxShadow: "0 24px 60px var(--lk-shadow-700, rgba(0,0,0,0.7))", animation: "fade-in 0.18s ease-out",
      }}>
        <button type="button" aria-label="Close" onClick={onClose} style={{
          position: "absolute", top: 14, right: 14, width: 44, height: 44, borderRadius: "50%", cursor: "pointer",
          background: "var(--lk-fill-080, rgba(255,255,255,0.08))", border: "1px solid var(--lk-line-200, rgba(255,255,255,0.2))", color: INK, fontSize: 18, fontWeight: 700,
        }}>✕</button>
        {children}
      </div>
    </div>
  );
}

/** A quick question only a grown-up answers (Apple's rule for kids' apps). */
function GrownUpGate({ onPass, onCancel }: { onPass: () => void; onCancel: () => void }) {
  const make = () => {
    const a = 6 + Math.floor(Math.random() * 7), b = 4 + Math.floor(Math.random() * 6);
    const ok = a + b;
    const opts = new Set([ok]);
    while (opts.size < 3) opts.add(ok + (Math.floor(Math.random() * 7) - 3) || ok + 5);
    return { a, b, ok, opts: Array.from(opts).sort(() => Math.random() - 0.5) };
  };
  const [q, setQ] = useState(make);
  const [wrong, setWrong] = useState(false);
  return (
    <Sheet onClose={onCancel} testId="grown-up-gate">
      <div style={{ textAlign: "center" }}>
        <div style={{ color: ACCENT_T, fontSize: 13, fontWeight: 800, letterSpacing: "0.16em" }}>FOR GROWN-UPS</div>
        <div style={{ fontFamily: SERIF, fontSize: 28, color: STRONG, marginTop: 6 }}>A quick grown-up check</div>
        <div style={{ fontSize: 22, color: INK, marginTop: 12 }}>What is <b data-testid="gate-question">{q.a} + {q.b}</b>?</div>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 18 }}>
          {q.opts.map(o => (
            <button key={o} type="button" data-testid={`gate-answer-${o}`} data-correct={o === q.ok ? "1" : "0"} onClick={() => { if (o === q.ok) onPass(); else { setWrong(true); setQ(make()); } }} style={{
              width: 84, height: 70, borderRadius: 18, cursor: "pointer", touchAction: "manipulation",
              background: "var(--lk-fill-080, rgba(255,255,255,0.08))", border: "1.5px solid var(--lk-line-250, rgba(255,255,255,0.25))",
              color: INK, fontFamily: FONT, fontSize: 26, fontWeight: 800,
            }}>{o}</button>
          ))}
        </div>
        {wrong && <div style={{ color: "var(--lk-warn-t, #fbbf24)", fontSize: 16, marginTop: 14 }}>Not quite. Here's a new one.</div>}
      </div>
    </Sheet>
  );
}

function SamplePages({ pages }: { pages: StorePage[] }) {
  const [i, setI] = useState(0);
  const p = pages[i] ?? {};
  const para = (t?: string) => (t ? t.split(/\n{2,}/).map((x, k) => <p key={k} style={{ margin: "0 0 10px" }}>{x}</p>) : null);
  const leaf: React.CSSProperties = { flex: 1, minWidth: 0, padding: "22px 20px", fontFamily: "Merriweather, Georgia, serif", fontSize: 17, lineHeight: 1.7, color: "#2D1A08", overflow: "hidden" };
  return (
    <div>
      <div style={{ display: "flex", background: "#F4E7CF", borderRadius: 14, minHeight: 340, maxHeight: 460, overflow: "hidden", boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.15)" }}>
        {p.imageUrl ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "#e8dcc4" }}><img src={p.imageUrl} alt="" style={{ maxWidth: "100%", maxHeight: 460, objectFit: "contain" }} /></div>
        ) : (
          <>
            <div style={{ ...leaf, borderRight: "2px solid rgba(92,58,30,0.35)" }}>
              {p.leftChapter && <div style={{ fontFamily: SERIF, fontSize: 22, textAlign: "center", marginBottom: 12 }}>{p.leftChapter}</div>}
              {para(p.leftBody)}
            </div>
            <div style={leaf}>{p.rightIsTitle ? <div style={{ textAlign: "center", marginTop: 50, fontFamily: SERIF, fontSize: 26 }}>{p.rightTitle}<div style={{ fontSize: 17, fontStyle: "italic", marginTop: 8 }}>{p.rightTitleSub}</div></div> : para(p.rightBody)}</div>
          </>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
        <BigButton ghost onClick={() => setI(x => Math.max(0, x - 1))} disabled={i === 0}>← Back</BigButton>
        <span style={{ color: MUTED, fontSize: 16 }}>{i + 1} of {pages.length}</span>
        <BigButton ghost onClick={() => setI(x => Math.min(pages.length - 1, x + 1))} disabled={i >= pages.length - 1}>Next →</BigButton>
      </div>
    </div>
  );
}
