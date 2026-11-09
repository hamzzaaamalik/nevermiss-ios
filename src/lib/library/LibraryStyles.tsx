/**
 * The three cover-based Library styles: Bookshelf, Storefront and Clean List.
 * ("Classic", the list from before, stays inside App.tsx's LibraryView.)
 *
 * Every book cell carries data-book-id so the two iPads can keep the same book
 * in view while scrolling, even though the Pro and the mini lay out differently.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

export interface ShelfBook {
  id: string;
  title: string;
  author: string;
  emoji: string;
  spineColor: string;
  tagline?: string;
  ageRange?: string;
  readingLevel?: string;
  pages: ArrayLike<unknown>;
  coverUrl?: string;
  /** A small cover picture made by the admin (Step 5); preferred over the full one. */
  coverThumbUrl?: string;
}
export interface ShelfProgress { bookId: string; currentPage: number; lastReadAt: string }
export interface BookGroup { key: string; title: string; books: ShelfBook[] }
/** The book at the top of the Library and its distance from the top, in pixels. */
export interface LibraryAnchor { id: string; off: number }

const AGE_GROUPS: Array<{ tier: string; title: string }> = [
  { tier: "4-5", title: "For ages 4 to 5" },
  { tier: "5-7", title: "For ages 5 to 7" },
  { tier: "7-10", title: "For ages 7 to 10" },
  { tier: "10-13", title: "For ages 10 to 13" },
];

/** "Continue reading" first (most recent first), then one group per age, then the rest. */
export function groupBooks(books: ShelfBook[], progressById: Map<string, ShelfProgress>): BookGroup[] {
  const inProgress = (b: ShelfBook) => { const p = progressById.get(b.id); return !!p && p.currentPage >= 1 && p.currentPage < b.pages.length; };
  const reading = books.filter(inProgress).sort((a, b) =>
    new Date(progressById.get(b.id)!.lastReadAt).getTime() - new Date(progressById.get(a.id)!.lastReadAt).getTime());
  const rest = books.filter(b => !inProgress(b));
  const tierOf = (b: ShelfBook) => (b.ageRange ?? "").toLowerCase().replace(/[–—]/g, "-");
  const groups: BookGroup[] = [{ key: "reading", title: "Continue reading", books: reading }];
  const placed = new Set<string>();
  for (const g of AGE_GROUPS) {
    const list = rest.filter(b => !placed.has(b.id) && tierOf(b).includes(g.tier));
    list.forEach(b => placed.add(b.id));
    groups.push({ key: g.tier, title: g.title, books: list });
  }
  groups.push({ key: "more", title: "More books", books: rest.filter(b => !placed.has(b.id)) });
  return groups.filter(g => g.books.length > 0);
}

const FOIL = "#E2C98E";

/** A book cover: the cover picture when there is one, otherwise a cloth binding with the title in gold. */
export function BookCover({ book, width, height }: { book: ShelfBook; width: number; height: number }) {
  const src = book.coverThumbUrl || book.coverUrl || "";
  const [failed, setFailed] = useState(false);
  const f = Math.round(width * 0.118);
  const frame: CSSProperties = {
    position: "relative", display: "block", flex: "none", overflow: "hidden",
    width, height, borderRadius: "3px 7px 7px 3px",
    background: book.spineColor || "#5C3A1E",
    boxShadow: "var(--lk-cover-shadow, 0 10px 22px rgba(0,0,0,0.5), 0 2px 4px rgba(0,0,0,0.4))",
  };
  const spine = (
    <span aria-hidden style={{
      position: "absolute", inset: 0, pointerEvents: "none", borderRadius: "inherit",
      background: "linear-gradient(90deg, rgba(0,0,0,0.26), rgba(255,255,255,0.14) 3.5%, rgba(0,0,0,0.08) 6%, transparent 10%)",
      boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)",
    }} />
  );
  if (src && !failed) {
    return (
      <span style={frame}>
        <img src={src} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        {spine}
      </span>
    );
  }
  const long = book.title.length > 24;
  return (
    <span style={{ ...frame, background: `linear-gradient(135deg, rgba(255,255,255,0.07), rgba(0,0,0,0.14)), ${book.spineColor || "#5C3A1E"}` }}>
      <span style={{
        position: "absolute", top: "6%", right: "6%", bottom: "6%", left: "9%",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between",
        padding: "11% 7% 8%", border: `1px solid ${FOIL}`,
        boxShadow: `inset 0 0 0 2px ${book.spineColor || "#5C3A1E"}, inset 0 0 0 3px rgba(226,201,142,0.55)`,
        textAlign: "center", fontSize: f, color: FOIL, overflow: "hidden",
      }}>
        <b style={{ fontFamily: "Playfair Display, Georgia, serif", fontWeight: 700, lineHeight: 1.16, fontSize: long ? "0.86em" : "1em" }}>{book.title}</b>
        <span aria-hidden style={{ fontSize: Math.max(18, f * 1.6), lineHeight: 1 }}>{book.emoji}</span>
        <small style={{ fontSize: "0.54em", fontWeight: 600, letterSpacing: "0.09em", textTransform: "uppercase", lineHeight: 1.25 }}>{book.author}</small>
      </span>
      {spine}
    </span>
  );
}

/** Where a reader is in a book, for the line under a cover. */
function noteFor(book: ShelfBook, p: ShelfProgress | undefined): { text: string; pct: number | null; done: boolean } {
  const total = book.pages.length;
  if (p && p.currentPage >= 1 && total > 0) {
    if (p.currentPage >= total) return { text: "Finished", pct: null, done: true };
    return { text: `Page ${p.currentPage} of ${total}`, pct: Math.min(100, Math.round((p.currentPage / total) * 100)), done: false };
  }
  return { text: book.ageRange ? `Ages ${book.ageRange.replace(/^ages\s*/i, "")}` : "", pct: null, done: false };
}

function ProgressBar({ pct }: { pct: number }) {
  return (
    <span aria-hidden style={{ display: "block", height: 4, borderRadius: 999, margin: "5px auto 0", width: "70%", background: "var(--lk-track, rgba(255,255,255,0.18))", overflow: "hidden" }}>
      <span style={{ display: "block", height: "100%", width: `${pct}%`, background: "var(--lk-accent, #C9922A)" }} />
    </span>
  );
}

interface StyleProps {
  groups: BookGroup[];
  selectedId: string;
  /** Undefined on the child's iPad: covers are not tappable there. */
  onSelect?: (id: string) => void;
  progressById: Map<string, ShelfProgress>;
}

/** A cover with its title and note, as a button for Nana or a plain block for the child. */
function CoverCell({ book, w, h, sel, onSelect, p, gap }: { book: ShelfBook; w: number; h: number; sel: boolean; onSelect?: (id: string) => void; p?: ShelfProgress; gap: number }) {
  const note = noteFor(book, p);
  const inner = (
    <>
      <span style={{ display: "block", width: w, margin: "0 auto", borderRadius: 8, outline: sel ? "4px solid var(--lk-accent, #C9922A)" : "none", outlineOffset: 3 }}>
        <BookCover book={book} width={w} height={h} />
      </span>
      <span style={{ display: "block", marginTop: gap, lineHeight: 1.25 }}>
        <span style={{
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
          fontFamily: "DM Sans, sans-serif", fontSize: 14.5, fontWeight: 700, color: "var(--lk-strong, #FFFFFF)",
        }}>{book.title}</span>
        {note.text && (
          <small style={{ display: "block", marginTop: 3, fontFamily: "DM Sans, sans-serif", fontSize: 13, fontWeight: 600, color: note.done ? "var(--lk-ok-t, #86efac)" : "var(--lk-ink-720, rgba(247,240,227,0.72))" }}>
            {note.done ? "✓ " : ""}{note.text}
          </small>
        )}
        {note.pct !== null && <ProgressBar pct={note.pct} />}
      </span>
    </>
  );
  const style: CSSProperties = { flex: "none", width: w + 8, textAlign: "center", background: "none", border: "none", padding: 0, cursor: onSelect ? "pointer" : "default", touchAction: "manipulation" };
  return onSelect
    ? <button type="button" data-book-id={book.id} aria-pressed={sel} aria-label={`${book.title} by ${book.author}`} onClick={() => onSelect(book.id)} style={style}>{inner}</button>
    : <div data-book-id={book.id} style={style}>{inner}</div>;
}

/** How many columns fit; measured, so the Pro and the mini each fill their width. */
function useColumns(cell: number, gap: number, pad: number): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [cols, setCols] = useState(5);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setCols(Math.max(2, Math.floor((el.clientWidth - pad * 2 + gap) / (cell + gap))));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [cell, gap, pad]);
  return [ref, cols];
}

function GroupHead({ title, count }: { title: string; count: number }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, margin: "2px 8px 9px" }}>
      <h3 style={{ margin: 0, fontFamily: "Playfair Display, Georgia, serif", fontSize: 21, fontWeight: 700, lineHeight: 1.2, color: "var(--lk-strong, #FFFFFF)" }}>{title}</h3>
      <span style={{ fontFamily: "DM Sans, sans-serif", fontSize: 13, fontWeight: 600, color: "var(--lk-ink-720, rgba(247,240,227,0.72))" }}>{count} {count === 1 ? "book" : "books"}</span>
    </div>
  );
}

const CW = 150, CH = 200, CGAP = 30, CPAD = 26;

/** Bookshelf: covers standing on wooden shelves, one shelf per row. */
export function ShelfStyle({ groups, selectedId, onSelect, progressById }: StyleProps) {
  const [ref, cols] = useColumns(CW + 8, CGAP, CPAD);
  return (
    <div ref={ref} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {groups.map(g => {
        const rows: ShelfBook[][] = [];
        for (let i = 0; i < g.books.length; i += cols) rows.push(g.books.slice(i, i + cols));
        return (
          <section key={g.key} style={{ flex: "none" }}>
            <GroupHead title={g.title} count={g.books.length} />
            {rows.map((r, i) => (
              <div key={i} style={{
                position: "relative", display: "flex", alignItems: "flex-start", gap: CGAP,
                padding: `18px ${CPAD}px 0`, marginBottom: 12, borderRadius: "12px 12px 0 0",
                background: `linear-gradient(var(--lk-niche-1, rgba(0,0,0,0.34)), var(--lk-niche-2, rgba(0,0,0,0.1)) ${CH + 18}px, transparent ${CH + 18}px)`,
              }}>
                <span aria-hidden style={{
                  position: "absolute", left: 0, right: 0, top: CH + 18, height: 14, borderRadius: "0 0 4px 4px",
                  background: "repeating-linear-gradient(90deg, rgba(255,255,255,0.04) 0 3px, transparent 3px 13px), linear-gradient(var(--lk-shelf, #6A5138), var(--lk-shelf-2, #46331F))",
                  borderTop: "1px solid rgba(255,255,255,0.26)", boxShadow: "0 9px 14px rgba(0,0,0,0.22)",
                }} />
                {r.map(b => <CoverCell key={b.id} book={b} w={CW} h={CH} sel={b.id === selectedId} onSelect={onSelect} p={progressById.get(b.id)} gap={24} />)}
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

/** Storefront: one big featured book, then rows of covers. */
export function StorefrontStyle({ groups, selectedId, onSelect, progressById, featured, featuredAction }: StyleProps & {
  featured: ShelfBook | null;
  /** The gold button on the featured book (Nana only). */
  featuredAction?: ReactNode;
}) {
  const fw = 142, fh = 190, gap = 28;
  const [ref, cols] = useColumns(fw + 8, gap, 8);
  const fp = featured ? progressById.get(featured.id) : undefined;
  const reading = !!(featured && fp && fp.currentPage >= 1 && fp.currentPage < featured.pages.length);
  return (
    <div ref={ref} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {featured && (
        <div style={{
          flex: "none", display: "flex", gap: 30, alignItems: "center", padding: "24px 32px", borderRadius: 20,
          border: "1px solid var(--lk-line-120, rgba(255,255,255,0.12))",
          background: `linear-gradient(105deg, ${featured.spineColor}55, var(--lk-row, #131F35) 82%)`,
        }}>
          <BookCover book={featured} width={156} height={208} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <span style={{ display: "block", fontFamily: "DM Sans, sans-serif", fontSize: 12, fontWeight: 800, letterSpacing: "0.14em", color: "var(--lk-accent-t, #C9922A)" }}>
              {reading ? "CONTINUE READING" : featured.id === selectedId ? "YOUR CHOICE" : "FEATURED"}
            </span>
            <h2 style={{ margin: "7px 0 0", fontFamily: "Playfair Display, Georgia, serif", fontSize: 36, fontWeight: 700, lineHeight: 1.12, color: "var(--lk-strong, #FFFFFF)" }}>{featured.title}</h2>
            <p style={{ margin: "6px 0 0", fontFamily: "DM Sans, sans-serif", fontSize: 15, fontWeight: 600, color: "var(--lk-ink-720, rgba(247,240,227,0.72))" }}>
              {featured.author}{featured.ageRange ? ` · Ages ${featured.ageRange.replace(/^ages\s*/i, "")}` : ""}
            </p>
            {featured.tagline && (
              <p style={{ margin: "8px 0 0", maxWidth: 640, fontFamily: "Merriweather, Georgia, serif", fontSize: 15.5, lineHeight: 1.55, color: "var(--lk-ink, #F7F0E3)", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{featured.tagline}</p>
            )}
            {featuredAction && <div style={{ marginTop: 14 }}>{featuredAction}</div>}
          </div>
        </div>
      )}
      {groups.map(g => (
        <section key={g.key} style={{ flex: "none", marginTop: 6 }}>
          <GroupHead title={g.title} count={g.books.length} />
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, ${fw + 8}px)`, justifyContent: "space-between", rowGap: 22, padding: "6px 8px" }}>
            {g.books.map(b => <CoverCell key={b.id} book={b} w={fw} h={fh} sel={b.id === selectedId} onSelect={onSelect} p={progressById.get(b.id)} gap={10} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

/** Clean List: tidy rows with a small cover and the details. */
export function CleanListStyle({ groups, selectedId, onSelect, progressById }: StyleProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {groups.map(g => (
        <section key={g.key} style={{ flex: "none" }}>
          <GroupHead title={g.title} count={g.books.length} />
          {g.books.map(b => {
            const sel = b.id === selectedId;
            const note = noteFor(b, progressById.get(b.id));
            const meta = [b.ageRange ? `Ages ${b.ageRange.replace(/^ages\s*/i, "")}` : "", b.readingLevel, `${b.pages.length} pages`].filter(Boolean).join(" · ");
            const inner = (
              <>
                <BookCover book={b} width={72} height={96} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontFamily: "Playfair Display, Georgia, serif", fontSize: 20, fontWeight: 700, lineHeight: 1.2, color: "var(--lk-strong, #FFFFFF)" }}>{b.title}</span>
                  <span style={{ display: "block", marginTop: 2, fontFamily: "DM Sans, sans-serif", fontSize: 14, fontWeight: 600, color: "var(--lk-ink-720, rgba(247,240,227,0.72))" }}>{b.author}</span>
                  {b.tagline && <span style={{ display: "block", marginTop: 5, fontFamily: "Merriweather, Georgia, serif", fontSize: 14, lineHeight: 1.45, color: "var(--lk-ink-720, rgba(247,240,227,0.72))", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.tagline}</span>}
                  <span style={{ display: "block", marginTop: 5, fontFamily: "DM Sans, sans-serif", fontSize: 12.5, fontWeight: 600, color: "var(--lk-ink-720, rgba(247,240,227,0.72))" }}>{meta}</span>
                </span>
                <span style={{ flex: "none", minWidth: 112, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                  {sel ? (
                    <span aria-label="Selected" style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--lk-accent, #C9922A)", color: "var(--lk-navy, #1B2B4B)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 800 }}>✓</span>
                  ) : note.pct !== null || note.done ? (
                    <span style={{ padding: "5px 14px", borderRadius: 15, border: "1px solid var(--lk-accent-420, rgba(201,146,42,0.42))", fontFamily: "DM Sans, sans-serif", fontSize: 13, fontWeight: 700, color: note.done ? "var(--lk-ok-t, #86efac)" : "var(--lk-accent-t, #C9922A)", whiteSpace: "nowrap" }}>{note.done ? "✓ Finished" : note.text}</span>
                  ) : null}
                </span>
              </>
            );
            const style: CSSProperties = {
              flex: "none", display: "flex", width: "100%", alignItems: "center", gap: 20, padding: "13px 14px", textAlign: "left",
              background: sel ? "var(--lk-row-sel, #1D232D)" : "none", border: "none",
              borderBottom: sel ? "1px solid transparent" : "1px solid var(--lk-line-080, rgba(255,255,255,0.08))",
              borderRadius: sel ? 12 : 0, boxShadow: sel ? "inset 0 0 0 1.5px var(--lk-accent, #C9922A)" : "none",
              cursor: onSelect ? "pointer" : "default", touchAction: "manipulation",
            };
            return onSelect
              ? <button key={b.id} type="button" data-book-id={b.id} aria-pressed={sel} onClick={() => onSelect(b.id)} style={style}>{inner}</button>
              : <div key={b.id} data-book-id={b.id} style={style}>{inner}</div>;
          })}
        </section>
      ))}
    </div>
  );
}

/** The book nearest the top of a scroller and how far it sits from the top, for syncing by book. */
export function readAnchor(scroller: HTMLElement): LibraryAnchor | null {
  const top = scroller.getBoundingClientRect().top;
  const cells = scroller.querySelectorAll<HTMLElement>("[data-book-id]");
  for (const c of Array.from(cells)) {
    const r = c.getBoundingClientRect();
    if (r.bottom > top + 4) return { id: c.dataset.bookId!, off: Math.round(r.top - top) };
  }
  return null;
}

/** Scroll so the anchor book sits where it does on the other iPad. False when that book isn't shown here. */
export function applyAnchor(scroller: HTMLElement, a: LibraryAnchor): boolean {
  const cell = scroller.querySelector<HTMLElement>(`[data-book-id="${CSS.escape(a.id)}"]`);
  if (!cell) return false;
  const delta = cell.getBoundingClientRect().top - scroller.getBoundingClientRect().top - a.off;
  scroller.scrollTop += delta;
  return true;
}
