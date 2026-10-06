import { PARA_INDENT_EM, tokenizeHalf, type WordTok } from "./words";

/**
 * Measured pagination (Rick's Pagination Spec, Oct 2026).
 *
 * A chapter's words are laid out once in a hidden paragraph styled exactly
 * like the book body, and every word's line is read back. Pages are then
 * cut every N lines, where N is how many lines that page holds, so every
 * page is filled to the bottom and only a chapter's last page ends early.
 * Cutting a long layout is exact because line breaking is greedy: text
 * that opens a page starts a fresh line in the long layout too, so the
 * page lays out on its own exactly as it did there.
 *
 * Pages no longer follow the importer's chunks: a spread can begin on any
 * word. Positions are words, not pages: (source page, word index on that
 * page, left half first), which stay put when the font size changes.
 *
 * Nana's iPad plans for both iPads and publishes the plan. Both draw the
 * book in a box of the plan's "stage" size (the smaller of the two book
 * areas), scaled up to fill a larger screen, so both show the same words
 * on every page and every page is full on both.
 */

export interface PlanPage {
  leftEmoji?: string;
  leftChapter?: string | null;
  leftBody?: string;
  rightBody?: string;
  rightIsTitle?: boolean;
  imageUrl?: string;
  signOff?: boolean;
  images?: string[];
  /** The half's first word starts a paragraph (books imported with
   *  paragraphs; breaks inside a half are blank lines in its text). */
  leftPara?: boolean;
  rightPara?: boolean;
}

/** A word: 1-based source page + index among that page's words (left
 *  half, then right half). */
export interface PlanPos { page: number; off: number }

export interface StageSize { w: number; h: number }

/** What one iPad measured of its reading box. Everything that depends
 *  on the text size, page mode or box size is derived from it (see
 *  `boxFor`), so a new size or mode is planned before the book is
 *  redrawn in it and the switch happens in one step. */
export interface PageProfile {
  role: "nana" | "perry";
  /** Page mode and text size (percent) the book was drawn in. */
  mode: "single" | "double";
  fontPct: number;
  /** Size of the box the book was drawn in. */
  stageW: number;
  stageH: number;
  /** This iPad's own book area (before any shared-stage scaling). */
  areaW: number;
  areaH: number;
  /** Text column width as drawn, and the page's side padding. */
  colWidth: number;
  pagePadX: number;
  /** Font size the text size percentage applies to; line height as a
   *  multiple of the font size. */
  parentPx: number;
  lhFactor: number;
  letterSpacingEm: number;
  wordSpacingEm: number;
  /** The body paragraph's other text styles (kebab-case CSS). */
  text: Record<string, string>;
  /** Body height available in a left column without a chapter heading. */
  capLeftPlainPx: number;
  /** Body height available in a right column. */
  capRightPx: number;
}

/** A reading box for one page mode, text size and box size: what the
 *  planner lays text out in. */
export interface ReadingBox {
  colWidth: number;
  fontPx: number;
  lineHeightPx: number;
  letterSpacingEm: number;
  wordSpacingEm: number;
  text: Record<string, string>;
  capLeftPlainPx: number;
  capRightPx: number;
  headNameFontPx: number;
}

export interface PagePlan {
  bookId: string;
  key: string;
  mode: "single" | "double";
  /** Source page where each displayed spread begins. */
  starts: number[];
  /** Word on that page where the spread begins (0 = the page's first). */
  offs: number[];
  /** Words in the left column of each spread; -1 = one source page
   *  shown by halves (picture, title and closing pages, unplanned runs). */
  splits: number[];
  /** Box both iPads draw the book in. */
  stage?: StageSize;
  /** Text size (percent) the pages were cut for. Both iPads draw a
   *  measured plan at this size and in its `mode`. Absent on a plan of
   *  whole source pages. */
  fontPct?: number;
  /** While chapters are still being planned: the expected final spread
   *  count, so the page total doesn't drift on screen. */
  estimatedTotal?: number;
}

/** Text styles copied from the reader's body paragraph into a profile. */
export const TEXT_STYLE_PROPS = [
  "font-family", "font-weight", "font-style", "font-stretch",
  "font-feature-settings", "font-variant-ligatures", "font-variant-numeric",
  "font-kerning", "text-rendering", "text-transform", "text-indent",
  "hyphens", "-webkit-hyphens", "white-space", "word-break", "overflow-wrap", "line-break",
] as const;

/** Drop cap on a chapter's first paragraph. Shared with the reader so the
 *  planner measures the same narrowed opening lines. */
export const DROP_CAP_DECL =
  'font-family: "Playfair Display", serif; font-weight: 700; font-size: 3.4em; float: left; line-height: 0.9; padding: 0.06em 0.08em 0 0; margin-right: 0.04em;';

/** Body text size (percent) for the reader's S / M / L / XL pick. */
export function fontPctFor(fontScale: number): number {
  return fontScale >= 1.5 ? 150 : fontScale >= 1.25 ? 125 : fontScale >= 1 ? 100 : 88;
}

/** Chapter title size for a body text size. */
export function headingFontPx(fontPct: number): number {
  return fontPct >= 150 ? 28 : fontPct >= 125 ? 24 : fontPct >= 100 ? 20 : 18;
}

/** One-page mode caps the line at about 34em of body text, roughly 65
 *  characters (Rick's Pagination Spec: 60 to 75 per line). In units of
 *  the page's own font size. */
export function singlePageMaxEm(fontPct: number): number {
  return 0.34 * fontPct;
}

/** Chapter opener styles (picture, "Chapter 3", title, ornament). The
 *  reader and the planner both use these, so the planner's heading is
 *  exactly the one on screen. Every size is explicit: nothing inherited
 *  changes its height. */
export function chapterHeadingStyles(headPx: number) {
  return {
    wrap: { display: "block", textAlign: "center", marginBottom: "12px" },
    motif: { display: "block", height: "54px", lineHeight: "54px", fontSize: "44px", marginBottom: "6px", overflow: "hidden", letterSpacing: "0px" },
    eyebrow: { display: "block", fontFamily: "Merriweather, serif", fontSize: "10px", lineHeight: "14px", fontWeight: "700", letterSpacing: "0.22em", textTransform: "uppercase", marginBottom: "6px" },
    name: { display: "block", fontFamily: "'Playfair Display', serif", fontSize: `${headPx}px`, lineHeight: "1.15", fontWeight: "700", letterSpacing: "0.005em", marginBottom: "4px" },
    rule: { display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", marginTop: "8px", height: "10px", overflow: "hidden" },
  } as const;
}

/** "Chapter 3 · The Hunt" → eyebrow "Chapter 3", title "The Hunt". */
export function splitChapterLabel(label: string): { num: string | null; name: string } {
  const parts = label.split(" · ");
  return parts.length > 1 ? { num: parts[0], name: parts.slice(1).join(" · ") } : { num: null, name: label };
}

// ── Pages and words ───────────────────────────────────────────────────

/** Title, full-page picture and closing pages: always their own spread. */
export function isSoloPage(p: PlanPage | undefined): boolean {
  return !p || !!(p.rightIsTitle || p.imageUrl || p.signOff);
}

function hasImages(p: PlanPage | undefined): boolean {
  return !!(p?.images && p.images.length > 0);
}

/** The chapter heading drawn on a spread that opens page `i` (0-based):
 *  only where the label changes, so books that repeat the chapter label
 *  on every page show it once. */
export function headingAt(pages: PlanPage[], i: number): string | null {
  const p = pages[i];
  if (!p?.leftChapter) return null;
  const prev = i > 0 ? pages[i - 1] : undefined;
  if (prev && !isSoloPage(prev) && prev.leftChapter === p.leftChapter) return null;
  return p.leftChapter;
}

export function pageWordCount(p: PlanPage | undefined): number {
  if (!p) return 0;
  return tokenizeHalf(p.leftBody).length + tokenizeHalf(p.rightBody).length;
}

export function cmpPos(a: PlanPos, b: PlanPos): number {
  return a.page !== b.page ? a.page - b.page : a.off - b.off;
}

/** Position of a word id (`${page}.${L|R}.${index}`). */
export function widPos(pages: PlanPage[], wid: string): PlanPos | null {
  const m = /^(\d+)\.(L|R)\.(\d+)$/.exec(wid);
  if (!m) return null;
  const page = Number(m[1]);
  const idx = Number(m[3]);
  if (m[2] === "L") return { page, off: idx };
  return { page, off: tokenizeHalf(pages[page - 1]?.leftBody).length + idx };
}

// ── Plan lookups ──────────────────────────────────────────────────────

export function identityPlan(bookId: string, pageCount: number, mode: "single" | "double"): PagePlan {
  const starts: number[] = [];
  const offs: number[] = [];
  const splits: number[] = [];
  for (let i = 1; i <= Math.max(1, pageCount); i++) { starts.push(i); offs.push(0); splits.push(-1); }
  return { bookId, key: `identity|${mode}`, mode, starts, offs, splits };
}

/** Index of the spread holding word `off` of source page `page`. */
export function spreadIndexOf(plan: PagePlan, page: number, off = 0): number {
  const s = plan.starts;
  const o = plan.offs;
  let lo = 0, hi = s.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const before = s[mid] < page || (s[mid] === page && (o[mid] ?? 0) <= off);
    if (before) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

export function spreadStart(plan: PagePlan, k: number): PlanPos {
  return { page: plan.starts[k] ?? 1, off: plan.offs[k] ?? 0 };
}

/** Exclusive end of spread k. */
export function spreadStop(plan: PagePlan, k: number, pageCount: number): PlanPos {
  if (k + 1 < plan.starts.length) return spreadStart(plan, k + 1);
  return { page: pageCount + 1, off: 0 };
}

/** Last source page with words on spread k. */
export function spreadLastPage(plan: PagePlan, k: number, pageCount: number): number {
  const s = spreadStart(plan, k);
  const e = spreadStop(plan, k, pageCount);
  return Math.max(s.page, e.off > 0 ? e.page : e.page - 1);
}

/** Whether spread k has anything on its right-hand page (one-page mode
 *  skips an empty right side). */
export function spreadHasRight(pages: PlanPage[], plan: PagePlan, k: number): boolean {
  const s = spreadStart(plan, k);
  const first = pages[s.page - 1];
  if (!first || first.imageUrl) return false;
  if (first.rightIsTitle && s.off === 0) return s.page !== 1;
  const { rightSegs } = composeSpread(pages, s, spreadStop(plan, k, pages.length), plan.splits[k] ?? -1);
  return rightSegs.length > 0;
}

/** First word of spread k's right-hand page, if it has words. */
export function rightStartPos(pages: PlanPage[], plan: PagePlan, k: number): PlanPos | null {
  const s = spreadStart(plan, k);
  if (pages[s.page - 1]?.imageUrl || (pages[s.page - 1]?.rightIsTitle && s.off === 0)) return null;
  const { rightSegs } = composeSpread(pages, s, spreadStop(plan, k, pages.length), plan.splits[k] ?? -1);
  const seg = rightSegs[0];
  if (!seg) return null;
  const dot = seg.key.indexOf(".");
  const page = Number(seg.key.slice(0, dot));
  const half = seg.key.slice(dot + 1);
  return half === "L" ? { page, off: seg.start } : { page, off: tokenizeHalf(pages[page - 1]?.leftBody).length + seg.start };
}

/** Identifies a plan version (a plan being built keeps its key while its
 *  chapters fill in). Must match the server's planSig. */
export function planSignature(plan: { key: string; starts: number[]; estimatedTotal?: number } | null | undefined): string {
  return plan ? `${plan.key}|${plan.starts.length}|${plan.estimatedTotal ?? ""}` : "";
}

/** Validate a plan received from Nana's iPad (or an older app). */
export function asPagePlan(raw: unknown): PagePlan | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.bookId !== "string" || !Array.isArray(r.starts) || !Array.isArray(r.splits)) return null;
  const starts = r.starts as unknown[];
  const splits = r.splits as unknown[];
  const offs = Array.isArray(r.offs) ? (r.offs as unknown[]) : starts.map(() => 0);
  if (starts.length === 0 || starts.length !== splits.length || offs.length !== starts.length) return null;
  if (!starts.every(n => typeof n === "number" && Number.isInteger(n) && n > 0)) return null;
  if (!offs.every(n => typeof n === "number" && Number.isInteger(n) && n >= 0)) return null;
  if (!splits.every(n => typeof n === "number" && Number.isInteger(n) && n >= -1)) return null;
  if (starts[0] !== 1 || offs[0] !== 0) return null;
  for (let k = 1; k < starts.length; k++) {
    const a = { page: starts[k - 1] as number, off: offs[k - 1] as number };
    const b = { page: starts[k] as number, off: offs[k] as number };
    if (cmpPos(a, b) >= 0) return null;
  }
  const est = r.estimatedTotal;
  const pct = r.fontPct;
  const st = r.stage as Record<string, unknown> | undefined;
  const stageOk = !!st && typeof st.w === "number" && typeof st.h === "number"
    && st.w >= 80 && st.w <= 6000 && st.h >= 80 && st.h <= 6000;
  return {
    bookId: r.bookId,
    key: typeof r.key === "string" ? r.key : "",
    mode: r.mode === "single" ? "single" : "double",
    starts: starts as number[],
    offs: offs as number[],
    splits: splits as number[],
    ...(stageOk ? { stage: { w: st!.w as number, h: st!.h as number } } : {}),
    ...(typeof pct === "number" && pct >= 40 && pct <= 400 ? { fontPct: pct } : {}),
    ...(typeof est === "number" && Number.isInteger(est) && est > 0 ? { estimatedTotal: est } : {}),
  };
}

/** Left and right column word runs for a spread, as source-half segments
 *  so every word keeps its stable id. */
export interface ColumnSegment {
  /** `${sourcePage}.${half}` */
  key: string;
  toks: WordTok[];
  /** Index of toks[0] within its half. */
  start: number;
  /** toks[0] is the half's first word and starts a paragraph. */
  para?: boolean;
}

/** Break before word i of a segment: 2 = new paragraph, 1 = new line. */
export function segBreak(seg: ColumnSegment, i: number): 0 | 1 | 2 {
  if (i === 0 && seg.start === 0) return seg.para ? 2 : 0;
  return seg.toks[i].brk ?? 0;
}

export function composeSpread(
  pages: PlanPage[],
  start: PlanPos,
  stop: PlanPos,
  split: number,
): { leftSegs: ColumnSegment[]; rightSegs: ColumnSegment[] } {
  const halves: ColumnSegment[] = [];
  const last = Math.min(stop.page, pages.length);
  for (let src = start.page; src <= last; src++) {
    const p = pages[src - 1];
    if (!p) continue;
    const L = tokenizeHalf(p.leftBody);
    const R = tokenizeHalf(p.rightBody);
    const from = src === start.page ? start.off : 0;
    const to = src === stop.page ? stop.off : L.length + R.length;
    if (to <= from) continue;
    const lFrom = Math.min(from, L.length);
    const lTo = Math.min(to, L.length);
    if (lTo > lFrom) halves.push({ key: `${src}.L`, toks: lFrom === 0 && lTo === L.length ? L : L.slice(lFrom, lTo), start: lFrom, para: lFrom === 0 && !!p.leftPara });
    const rFrom = Math.max(from - L.length, 0);
    const rTo = Math.max(to - L.length, 0);
    if (rTo > rFrom) halves.push({ key: `${src}.R`, toks: rFrom === 0 && rTo === R.length ? R : R.slice(rFrom, rTo), start: rFrom, para: rFrom === 0 && !!p.rightPara });
  }
  if (split < 0) {
    const count = stop.page - start.page + (stop.off > 0 ? 1 : 0);
    if (count <= 1) {
      return {
        leftSegs: halves.filter(h => h.key.endsWith(".L")),
        rightSegs: halves.filter(h => h.key.endsWith(".R")),
      };
    }
    const mid = Math.ceil(halves.length / 2);
    return { leftSegs: halves.slice(0, mid), rightSegs: halves.slice(mid) };
  }
  const leftSegs: ColumnSegment[] = [];
  const rightSegs: ColumnSegment[] = [];
  let remaining = split;
  for (const h of halves) {
    if (remaining >= h.toks.length) {
      leftSegs.push(h);
      remaining -= h.toks.length;
    } else if (remaining > 0) {
      leftSegs.push({ key: h.key, toks: h.toks.slice(0, remaining), start: h.start, para: h.para });
      rightSegs.push({ key: h.key, toks: h.toks.slice(remaining), start: h.start + remaining });
      remaining = 0;
    } else {
      rightSegs.push(h);
    }
  }
  return { leftSegs, rightSegs };
}

// ── Profiles ──────────────────────────────────────────────────────────

/** Validate a profile received from the other iPad. */
export function asPageProfile(raw: unknown): PageProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const num = (k: string) => (typeof r[k] === "number" && Number.isFinite(r[k] as number) ? (r[k] as number) : NaN);
  const role = r.role === "nana" || r.role === "perry" ? r.role : null;
  const mode = r.mode === "single" || r.mode === "double" ? r.mode : null;
  const text: Record<string, string> = {};
  if (r.text && typeof r.text === "object") {
    for (const k of TEXT_STYLE_PROPS) {
      const v = (r.text as Record<string, unknown>)[k];
      if (typeof v === "string" && v.length <= 200) text[k] = v;
    }
  }
  const p: PageProfile = {
    role: role ?? "nana",
    mode: mode ?? "double",
    fontPct: num("fontPct"),
    stageW: num("stageW"),
    stageH: num("stageH"),
    areaW: num("areaW"),
    areaH: num("areaH"),
    colWidth: num("colWidth"),
    pagePadX: num("pagePadX"),
    parentPx: num("parentPx"),
    lhFactor: num("lhFactor"),
    letterSpacingEm: num("letterSpacingEm"),
    wordSpacingEm: num("wordSpacingEm"),
    text,
    capLeftPlainPx: num("capLeftPlainPx"),
    capRightPx: num("capRightPx"),
  };
  if (!role || !mode || !text["font-family"]) return null;
  const sane = (v: number, lo: number, hi: number) => Number.isFinite(v) && v >= lo && v <= hi;
  if (!sane(p.colWidth, 80, 4000)
      || !sane(p.capLeftPlainPx, 20, 4000) || !sane(p.capRightPx, 20, 4000)
      || !sane(p.stageW, 80, 6000) || !sane(p.stageH, 80, 6000)
      || !sane(p.areaW, 80, 6000) || !sane(p.areaH, 80, 6000)) return null;
  if (!sane(p.fontPct, 40, 400) || !sane(p.parentPx, 4, 80) || !sane(p.lhFactor, 0.8, 4) || !sane(p.pagePadX, 0, 400)) return null;
  if (!Number.isFinite(p.letterSpacingEm)) p.letterSpacingEm = 0;
  if (!Number.isFinite(p.wordSpacingEm)) p.wordSpacingEm = 0;
  return p;
}

function sameText(a: Record<string, string>, b: Record<string, string>): boolean {
  for (const k of TEXT_STYLE_PROPS) if ((a[k] ?? "") !== (b[k] ?? "")) return false;
  return true;
}

/** Same reading box within measurement noise. Re-measuring on every
 *  page turn must not trigger a re-plan. */
export function profilesClose(a: PageProfile, b: PageProfile): boolean {
  return a.role === b.role && a.mode === b.mode && a.fontPct === b.fontPct && sameText(a.text, b.text)
    && Math.abs(a.stageW - b.stageW) < 1 && Math.abs(a.stageH - b.stageH) < 1
    && Math.abs(a.areaW - b.areaW) < 4 && Math.abs(a.areaH - b.areaH) < 4
    && Math.abs(a.colWidth - b.colWidth) < 0.5
    && Math.abs(a.pagePadX - b.pagePadX) < 0.5
    && Math.abs(a.parentPx - b.parentPx) < 0.01
    && Math.abs(a.lhFactor - b.lhFactor) < 0.001
    && Math.abs(a.capLeftPlainPx - b.capLeftPlainPx) < 1
    && Math.abs(a.capRightPx - b.capRightPx) < 1
    && Math.abs(a.letterSpacingEm - b.letterSpacingEm) < 0.001
    && Math.abs(a.wordSpacingEm - b.wordSpacingEm) < 0.001;
}

/** A page's width in a `stageW` box: two pages share it evenly beside a
 *  4px spine; one page takes it up to the one-page line cap. */
function pageWidth(p: PageProfile, stageW: number, mode: "single" | "double", fontPct: number): number {
  const w = mode === "double" ? (stageW - 4) / 2 : Math.min(stageW, singlePageMaxEm(fontPct) * p.parentPx + p.pagePadX);
  return layoutUnit(w);
}

/** WebKit lays boxes out in 1/64px steps, cutting off the rest: a width
 *  worked out here must land on the same step as the real page, or a line
 *  that just fits on screen wraps in the planner and the page ends a line
 *  early. */
function layoutUnit(px: number): number {
  return Math.floor(px * 64 + 1e-6) / 64;
}

/** The reading box for a page mode, text size and box size, from what was
 *  measured. Everything above and below the text has a fixed height, so
 *  the text box grows one for one with the stage. */
export function boxFor(p: PageProfile, stage: StageSize, mode: "single" | "double", fontPct: number): ReadingBox {
  const fontPx = p.parentPx * fontPct / 100;
  const dh = stage.h - p.stageH;
  // A box measured before the book had its shared stage has a fractional
  // size, and the page split can round either way: err a step narrow
  // (a line may end early, never a word too many). Once the book is drawn
  // on the stage it is measured exactly and planned again.
  const exact = Number.isInteger(p.stageW) && Number.isInteger(p.stageH);
  return {
    colWidth: layoutUnit(p.colWidth + pageWidth(p, stage.w, mode, fontPct) - pageWidth(p, p.stageW, p.mode, p.fontPct)) - (exact ? 0 : 1 / 64),
    fontPx,
    lineHeightPx: p.lhFactor * fontPx,
    letterSpacingEm: p.letterSpacingEm,
    wordSpacingEm: p.wordSpacingEm,
    text: p.text,
    capLeftPlainPx: p.capLeftPlainPx + dh,
    capRightPx: p.capRightPx + dh,
    headNameFontPx: headingFontPx(fontPct),
  };
}

/** The box both iPads draw the book in: the smaller book area on each
 *  side. Small wobbles (under 24px) keep the current box, so a re-plan
 *  only happens when the room really changed. */
export function chooseStage(areas: StageSize[], current: StageSize | null): StageSize | null {
  if (areas.length === 0) return current;
  const w = Math.floor(Math.min(...areas.map(a => a.w)));
  const h = Math.floor(Math.min(...areas.map(a => a.h)));
  if (current && current.w <= w && current.h <= h && w - current.w < 24 && h - current.h < 24) return current;
  return { w: w - (w % 2), h: h - (h % 2) };
}

function round(n: number, step = 1): number {
  return Math.round(n / step) * step;
}

export function boxSignature(b: ReadingBox): string {
  return [
    b.colWidth, round(b.fontPx, 0.05), round(b.lineHeightPx, 0.05),
    round(b.capLeftPlainPx), round(b.capRightPx), round(b.headNameFontPx),
    (b.text["font-family"] ?? "").length,
  ].join(":");
}

const PLAN_VERSION = "w5";

export function planKey(bookId: string, mode: "single" | "double", fontPct: number, stage: StageSize, boxes: ReadingBox[], contentHash: string): string {
  return [PLAN_VERSION, bookId, mode, fontPct, `${stage.w}x${stage.h}`, contentHash, ...boxes.map(boxSignature).sort()].join("|");
}

/** Cheap content fingerprint so a cached plan is never reused for an
 *  edited book. */
export function contentHash(pages: PlanPage[]): string {
  let h = 2166136261 >>> 0;
  const mix = (str: string | null | undefined) => {
    if (!str) { h = Math.imul(h ^ 7, 16777619) >>> 0; return; }
    for (let i = 0; i < str.length; i += 7) h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0;
    h = Math.imul(h ^ str.length, 16777619) >>> 0;
  };
  for (const p of pages) {
    mix(p.leftBody); mix(p.rightBody); mix(p.leftChapter ?? ""); mix(p.leftEmoji ?? "");
    h = Math.imul(h ^ (isSoloPage(p) ? 1 : 0) ^ (hasImages(p) ? 2 : 0) ^ (p.leftPara ? 4 : 0) ^ (p.rightPara ? 8 : 0), 16777619) >>> 0;
  }
  return `${pages.length}-${h.toString(36)}`;
}

// ── Measuring ─────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function kebab(k: string): string {
  return k.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
}

function applyStyles(el: HTMLElement, styles: Record<string, string>) {
  for (const [k, v] of Object.entries(styles)) el.style.setProperty(kebab(k), v);
}

/** Lines of one layout: line[i] is the line of word `from + i`. */
interface Layout { from: number; line: Int32Array }

class Measurer {
  private root: HTMLDivElement;
  private paras = new Map<string, HTMLParagraphElement>();
  private heads = new Map<string, number>();

  constructor() {
    this.root = document.createElement("div");
    this.root.setAttribute("aria-hidden", "true");
    this.root.className = "nm-plan-measure";
    // Words never break inside themselves, as in the reader; the drop cap
    // is shared.
    const style = document.createElement("style");
    style.textContent = `.nm-plan-measure p > span { white-space: nowrap; }
.nm-plan-measure p > span.i { display: inline-block; width: ${PARA_INDENT_EM}em; }
.nm-plan-measure p.nm-plan-dc::first-letter { ${DROP_CAP_DECL} }`;
    this.root.appendChild(style);
    Object.assign(this.root.style, {
      position: "fixed", left: "-100000px", top: "0", visibility: "hidden",
      pointerEvents: "none", contain: "layout style",
    } as Partial<CSSStyleDeclaration>);
    document.body.appendChild(this.root);
  }

  dispose() {
    this.root.remove();
  }

  private para(p: ReadingBox): HTMLParagraphElement {
    const sig = boxSignature(p);
    let el = this.paras.get(sig);
    if (!el) {
      el = document.createElement("p");
      applyStyles(el, p.text);
      applyStyles(el, {
        margin: "0", padding: "0", border: "0",
        width: `${p.colWidth}px`,
        fontSize: `${p.fontPx}px`,
        lineHeight: `${p.lineHeightPx}px`,
        letterSpacing: `${p.letterSpacingEm}em`,
        wordSpacing: `${p.wordSpacingEm}em`,
        textAlign: "justify",
      });
      this.root.appendChild(el);
      this.paras.set(sig, el);
    }
    return el;
  }

  /** Lay out words `from..` of `toks` and read back each word's line.
   *  `brks[i]`: line (1) or paragraph (2) break before word i; the first
   *  word of the run skips its indent when `noIndentFirst`. Same markup
   *  as the reader's WordWrapped. */
  layout(p: ReadingBox, toks: WordTok[], brks: Uint8Array, from: number, dropCap: boolean, noIndentFirst: boolean): Layout {
    const el = this.para(p);
    el.classList.toggle("nm-plan-dc", dropCap);
    let html = "";
    for (let i = from; i < toks.length; i++) {
      if (i > from) html += brks[i] ? "<br>" : toks[i - 1].glue ? "" : " ";
      if (brks[i] === 2 && !(i === 0 && noIndentFirst)) html += `<span class="i"></span>`;
      html += `<span class="t">${escapeHtml(toks[i].text)}</span>`;
    }
    el.innerHTML = html;
    const spans = el.getElementsByClassName("t");
    const line = new Int32Array(spans.length);
    const lh = p.lineHeightPx;
    let n = 0;
    let lineTop = spans.length > 0 ? (spans[0] as HTMLElement).offsetTop : 0;
    for (let j = 0; j < spans.length; j++) {
      const top = (spans[j] as HTMLElement).offsetTop;
      // A new line starts wherever a word sits clearly lower.
      if (top > lineTop + lh * 0.5) { n += Math.max(1, Math.round((top - lineTop) / lh)); lineTop = top; }
      line[j] = n;
    }
    el.innerHTML = "";
    return { from, line };
  }

  /** Height of the chapter opener for `title`, margin included. */
  headingPx(p: ReadingBox, title: string, motif: string | null): number {
    const sig = `${p.colWidth}|${p.headNameFontPx}|${motif ? 1 : 0}|${title}`;
    const hit = this.heads.get(sig);
    if (hit !== undefined) return hit;
    const st = chapterHeadingStyles(p.headNameFontPx);
    const wrap = document.createElement("div");
    applyStyles(wrap, st.wrap);
    wrap.style.width = `${p.colWidth}px`;
    const { num, name } = splitChapterLabel(title);
    if (motif) {
      const m = document.createElement("span");
      applyStyles(m, st.motif);
      m.textContent = motif;
      wrap.appendChild(m);
    }
    if (num) {
      const e = document.createElement("span");
      applyStyles(e, st.eyebrow);
      e.textContent = num;
      wrap.appendChild(e);
    }
    const t = document.createElement("span");
    applyStyles(t, st.name);
    t.textContent = name;
    wrap.appendChild(t);
    const rule = document.createElement("div");
    applyStyles(rule, st.rule);
    wrap.appendChild(rule);
    this.root.appendChild(wrap);
    const px = wrap.offsetHeight + 12;
    wrap.remove();
    this.heads.set(sig, px);
    return px;
  }
}

/** One iPad's running layout of a chapter, re-laid from a page's first
 *  word only when another iPad's narrower box ended the page mid-line. */
class RunCursor {
  private lay: Layout;
  constructor(private m: Measurer, private p: ReadingBox, private toks: WordTok[], private brks: Uint8Array, dropCap: boolean, private noIndentFirst: boolean) {
    this.lay = m.layout(p, toks, brks, 0, dropCap, noIndentFirst);
  }

  private lineOf(t: number): number { return this.lay.line[t - this.lay.from]; }

  /** End (exclusive) of a column that starts at word `t` and holds `cap`
   *  lines. */
  colEnd(t: number, cap: number): number {
    const n = this.toks.length;
    if (t >= n) return n;
    if (cap <= 0) return t;
    if (t > this.lay.from && this.lineOf(t - 1) === this.lineOf(t)) {
      this.lay = this.m.layout(this.p, this.toks, this.brks, t, false, this.noIndentFirst);
    }
    const stopLine = this.lineOf(t) + cap;
    let lo = t, hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.lineOf(mid) >= stopLine) hi = mid; else lo = mid + 1;
    }
    return lo;
  }
}

/** True when page i (0-based) must begin a new spread. */
function startsRun(pages: PlanPage[], i: number, chapterStarts: Set<number>): boolean {
  if (i === 0) return true;
  if (chapterStarts.has(i + 1)) return true;
  if (isSoloPage(pages[i]) || isSoloPage(pages[i - 1])) return true;
  if (hasImages(pages[i])) return true;
  return headingAt(pages, i) !== null;
}

export interface PlanInput {
  bookId: string;
  pages: PlanPage[];
  /** 1-based first pages of chapters (from book.chapters). */
  chapterStarts: Set<number>;
  mode: "single" | "double";
  /** Text size (percent) to cut pages for. */
  fontPct: number;
  /** Measured reading boxes (any mode, size and stage). */
  profiles: PageProfile[];
  /** Box both iPads will draw the book in. */
  stage: StageSize;
  /** Plan the run containing this page first. */
  focusPage: number;
  /** The plan in use before this one (same book). Runs not re-planned
   *  yet keep its spreads, so paging during a re-plan never jumps back
   *  to text already read. */
  previous?: PagePlan | null;
}

type Spread = [page: number, off: number, split: number];

/** Plan one run of pages (a chapter, or a chapter part after a picture
 *  page). `a`..`b` are 0-based, end exclusive. */
function planRun(m: Measurer, pages: PlanPage[], a: number, b: number, profiles: ReadingBox[]): Spread[] {
  const first = pages[a];
  if (isSoloPage(first)) return [[a + 1, 0, -1]];
  const toks: WordTok[] = [];
  const brkList: number[] = [];
  const posPage: number[] = [];
  const posOff: number[] = [];
  for (let i = a; i < b; i++) {
    const p = pages[i];
    const L = tokenizeHalf(p.leftBody);
    const R = tokenizeHalf(p.rightBody);
    let off = 0;
    L.forEach((t, j) => { toks.push(t); brkList.push(j === 0 ? (p.leftPara ? 2 : 0) : t.brk ?? 0); posPage.push(i + 1); posOff.push(off++); });
    R.forEach((t, j) => { toks.push(t); brkList.push(j === 0 ? (p.rightPara ? 2 : 0) : t.brk ?? 0); posPage.push(i + 1); posOff.push(off++); });
  }
  if (toks.length === 0) return [[a + 1, 0, 0]];
  const brks = Uint8Array.from(brkList);
  const heading = headingAt(pages, a);
  const images = hasImages(first);
  const motif = heading && first.leftEmoji ? first.leftEmoji : null;
  // The chapter's first paragraph follows its heading without an indent.
  const cursors = profiles.map(p => new RunCursor(m, p, toks, brks, !!heading && !images, !!heading));
  const lines = (p: ReadingBox, px: number) => Math.max(0, Math.floor((px + 0.5) / p.lineHeightPx));
  const capFirstL = profiles.map(p =>
    images ? 0 : lines(p, p.capLeftPlainPx - (heading ? m.headingPx(p, heading, motif) : 0)));
  const capL = profiles.map(p => lines(p, p.capLeftPlainPx));
  const capR = profiles.map(p => lines(p, p.capRightPx));
  const out: Spread[] = [];
  let t = 0;
  while (t < toks.length) {
    const firstSpread = out.length === 0;
    let mid = toks.length;
    cursors.forEach((c, i) => { mid = Math.min(mid, c.colEnd(t, firstSpread ? capFirstL[i] : capL[i])); });
    let end = toks.length;
    cursors.forEach((c, i) => { end = Math.min(end, c.colEnd(mid, capR[i])); });
    // A box too small for even one line still has to move on.
    if (end <= t) { end = t + 1; mid = Math.min(mid, end); }
    out.push(firstSpread ? [a + 1, 0, mid - t] : [posPage[t], posOff[t], mid - t]);
    t = end;
  }
  return out;
}

/**
 * Build the plan run by run, current run first, yielding to the UI
 * between runs. `onProgress` receives the plan so far (unplanned runs
 * keep the previous plan's spreads, or one source page per spread).
 * Resolves with the full plan, or null if aborted.
 */
export async function buildPagePlan(
  input: PlanInput,
  onProgress: (plan: PagePlan, done: boolean) => void,
  isAborted: () => boolean,
): Promise<PagePlan | null> {
  const { pages, chapterStarts, mode, bookId, stage, fontPct } = input;
  const profiles = input.profiles.map(p => boxFor(p, stage, mode, fontPct));
  const n = pages.length;
  const key = planKey(bookId, mode, fontPct, stage, profiles, contentHash(pages));

  const cached = readCache(key);
  if (cached) {
    onProgress(cached, true);
    return cached;
  }

  // Runs: maximal sequences of pages whose words flow together.
  const runs: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    if (startsRun(pages, i, chapterStarts)) runs.push([i, i + 1]);
    else runs[runs.length - 1][1] = i + 1;
  }
  const focusIdx = Math.max(0, Math.min(n - 1, input.focusPage - 1));
  const focusRun = Math.max(0, runs.findIndex(([a, b]) => focusIdx >= a && focusIdx < b));
  const order: number[] = [focusRun];
  for (let r = focusRun + 1; r < runs.length; r++) order.push(r);
  for (let r = focusRun - 1; r >= 0; r--) order.push(r);

  const planned = new Map<number, Spread[]>();
  const prev = input.previous && input.previous.bookId === bookId ? input.previous : null;
  /** The previous plan's spreads for run [a, b), if it planned that run. */
  const previousSpreads = (a: number, b: number): Spread[] | null => {
    if (!prev) return null;
    const k0 = spreadIndexOf(prev, a + 1, 0);
    if (prev.starts[k0] !== a + 1 || (prev.offs[k0] ?? 0) !== 0) return null;
    const out: Spread[] = [];
    for (let k = k0; k < prev.starts.length && prev.starts[k] <= b; k++) {
      const off = prev.offs[k] ?? 0;
      if (off > 0 && off >= pageWordCount(pages[prev.starts[k] - 1])) return null;
      out.push([prev.starts[k], off, prev.splits[k] ?? -1]);
    }
    return out;
  };
  const assemble = (done: boolean): PagePlan => {
    const starts: number[] = [];
    const offs: number[] = [];
    const splits: number[] = [];
    let plannedPages = 0;
    let plannedSpreads = 0;
    let unplannedPages = 0;
    runs.forEach(([a, b], r) => {
      const got = planned.get(r);
      const list = got ?? previousSpreads(a, b);
      if (list) {
        for (const [pg, off, sp] of list) { starts.push(pg); offs.push(off); splits.push(sp); }
      } else {
        for (let i = a; i < b; i++) { starts.push(i + 1); offs.push(0); splits.push(-1); }
      }
      if (got) { plannedPages += b - a; plannedSpreads += got.length; } else unplannedPages += b - a;
    });
    const plan: PagePlan = { bookId, key, mode, starts, offs, splits, stage: { w: stage.w, h: stage.h }, fontPct };
    if (!done && plannedPages > 0 && unplannedPages > 0) {
      plan.estimatedTotal = Math.round(plannedSpreads + unplannedPages * (plannedSpreads / plannedPages));
    }
    return plan;
  };

  if (typeof document !== "undefined" && document.fonts?.ready) {
    try { await document.fonts.ready; } catch {}
  }
  if (isAborted()) return null;

  const m = new Measurer();
  try {
    let lastEmit = 0;
    for (let oi = 0; oi < order.length; oi++) {
      const r = order[oi];
      const [a, b] = runs[r];
      planned.set(r, planRun(m, pages, a, b, profiles));
      const now = performance.now();
      if (oi === 0 || now - lastEmit > 800) {
        lastEmit = now;
        onProgress(assemble(false), false);
      }
      // Yield so taps and video stay smooth while long books plan.
      await new Promise(res => setTimeout(res, 0));
      if (isAborted()) return null;
    }
  } finally {
    m.dispose();
  }
  const plan = assemble(true);
  writeCache(key, plan);
  onProgress(plan, true);
  return plan;
}

const CACHE_PREFIX = "nm_plan:";

function readCache(key: string): PagePlan | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    return asPagePlan(JSON.parse(raw));
  } catch { return null; }
}

function writeCache(key: string, plan: PagePlan): void {
  try {
    // Keep the cache small: drop older plans first.
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(CACHE_PREFIX)) keys.push(k);
    }
    if (keys.length > 12) keys.slice(0, keys.length - 12).forEach(k => localStorage.removeItem(k));
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(plan));
  } catch {}
}
