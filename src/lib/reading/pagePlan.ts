import { tokenizeHalf, type WordTok } from "./words";

/**
 * Measured pagination (Rick's Build 33 A-3).
 *
 * Source pages from the importer are short, fixed-size chunks, so at most
 * font sizes a spread was a quarter full, and at large sizes text ran
 * past the bottom ("Scroll for more"). Nana's iPad now builds one page
 * plan for both iPads: consecutive source pages inside a chapter are
 * merged while their text fits the reading box of BOTH iPads, and each
 * spread's left/right split is chosen so both columns fit on both. The
 * child's iPad follows the published plan, so both iPads always show
 * the same words on each page and turn at the same point.
 *
 * Fit is measured, not estimated: a hidden paragraph styled exactly like
 * the book body (font, size, line height, column width, word span
 * padding) is laid out with the candidate text and each word's line is
 * read back.
 */

export interface PlanPage {
  leftChapter?: string | null;
  leftBody?: string;
  rightBody?: string;
  rightIsTitle?: boolean;
  imageUrl?: string;
  signOff?: boolean;
  images?: string[];
}

/** One iPad's reading box for the current page mode. */
export interface PageProfile {
  role: "nana" | "perry";
  mode: "single" | "double";
  colWidth: number;
  fontFamily: string;
  fontPx: number;
  lineHeightPx: number;
  letterSpacingEm: number;
  wordSpacingEm: number;
  fontFeatureSettings: string;
  /** Body height available in a left column without a chapter heading. */
  capLeftPlainPx: number;
  /** Body height available in a right column. */
  capRightPx: number;
  /** Chapter title font size (it scales with the viewport). */
  headNameFontPx: number;
}

export interface PagePlan {
  bookId: string;
  key: string;
  mode: "single" | "double";
  /** 1-based source page where each displayed spread begins. */
  starts: number[];
  /** Tokens in the left column of each spread; -1 = split by halves. */
  splits: number[];
  /** While chapters are still being planned: the expected final spread
   *  count, so the page total doesn't drift downward on screen. */
  estimatedTotal?: number;
}

const MAX_MERGE = 8;
const RIGHT_SAFETY_LINES = 1;

/** Validate a profile received from the other iPad. */
export function asPageProfile(raw: unknown): PageProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const num = (k: string) => (typeof r[k] === "number" && Number.isFinite(r[k] as number) ? (r[k] as number) : NaN);
  const role = r.role === "nana" || r.role === "perry" ? r.role : null;
  const mode = r.mode === "single" || r.mode === "double" ? r.mode : null;
  const p: PageProfile = {
    role: role ?? "nana",
    mode: mode ?? "double",
    colWidth: num("colWidth"),
    fontFamily: typeof r.fontFamily === "string" ? r.fontFamily.slice(0, 200) : "",
    fontPx: num("fontPx"),
    lineHeightPx: num("lineHeightPx"),
    letterSpacingEm: num("letterSpacingEm"),
    wordSpacingEm: num("wordSpacingEm"),
    fontFeatureSettings: typeof r.fontFeatureSettings === "string" ? r.fontFeatureSettings.slice(0, 200) : "normal",
    capLeftPlainPx: num("capLeftPlainPx"),
    capRightPx: num("capRightPx"),
    headNameFontPx: num("headNameFontPx"),
  };
  if (!role || !mode || !p.fontFamily) return null;
  const sane = (v: number, lo: number, hi: number) => Number.isFinite(v) && v >= lo && v <= hi;
  if (!sane(p.colWidth, 80, 4000) || !sane(p.fontPx, 6, 120) || !sane(p.lineHeightPx, 6, 240)
      || !sane(p.capLeftPlainPx, 20, 4000) || !sane(p.capRightPx, 20, 4000) || !sane(p.headNameFontPx, 6, 120)) return null;
  if (!Number.isFinite(p.letterSpacingEm)) p.letterSpacingEm = 0;
  if (!Number.isFinite(p.wordSpacingEm)) p.wordSpacingEm = 0;
  return p;
}

/** Validate a plan received from Nana's iPad. */
export function asPagePlan(raw: unknown): PagePlan | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.bookId !== "string" || !Array.isArray(r.starts) || !Array.isArray(r.splits)) return null;
  const starts = r.starts as unknown[];
  const splits = r.splits as unknown[];
  if (starts.length === 0 || starts.length !== splits.length) return null;
  let prev = 0;
  for (const n of starts) {
    if (typeof n !== "number" || !Number.isInteger(n) || n <= prev) return null;
    prev = n;
  }
  if (starts[0] !== 1) return null;
  if (!splits.every(n => typeof n === "number" && Number.isInteger(n) && n >= -1)) return null;
  const est = r.estimatedTotal;
  return {
    bookId: r.bookId,
    key: typeof r.key === "string" ? r.key : "",
    mode: r.mode === "single" ? "single" : "double",
    starts: starts as number[],
    splits: splits as number[],
    ...(typeof est === "number" && Number.isInteger(est) && est > 0 ? { estimatedTotal: est } : {}),
  };
}

/** Whether spread k has anything on its right-hand page (one-page mode
 *  skips an empty right side). */
export function spreadHasRight(pages: PlanPage[], plan: PagePlan, k: number): boolean {
  const start = plan.starts[k];
  if (start === undefined) return false;
  const first = pages[start - 1];
  if (!first || first.imageUrl) return false;
  if (first.rightIsTitle) return start !== 1;
  const { rightSegs } = composeSpread(pages, start, spreadEnd(plan, k, pages.length), plan.splits[k] ?? -1);
  return rightSegs.length > 0;
}

export function identityPlan(bookId: string, pageCount: number, mode: "single" | "double"): PagePlan {
  const starts: number[] = [];
  const splits: number[] = [];
  for (let i = 1; i <= Math.max(1, pageCount); i++) { starts.push(i); splits.push(-1); }
  return { bookId, key: `identity|${mode}`, mode, starts, splits };
}

/** Index of the spread containing `page` (1-based source page). */
export function spreadIndexOf(plan: PagePlan, page: number): number {
  const s = plan.starts;
  let lo = 0, hi = s.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (s[mid] <= page) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/** Exclusive end source page of spread k. */
export function spreadEnd(plan: PagePlan, k: number, pageCount: number): number {
  return plan.starts[k + 1] ?? pageCount + 1;
}

function isBreaker(p: PlanPage | undefined): boolean {
  if (!p) return true;
  return !!(p.rightIsTitle || p.imageUrl || p.signOff || (p.images && p.images.length > 0));
}

/** True when page i (0-based) must begin a new spread. */
function startsRun(pages: PlanPage[], i: number, chapterStarts: Set<number>): boolean {
  if (i === 0) return true;
  if (chapterStarts.has(i + 1)) return true;
  const cur = pages[i];
  const prev = pages[i - 1];
  if (isBreaker(cur) || isBreaker(prev)) return true;
  if (cur.leftChapter && cur.leftChapter !== prev.leftChapter) return true;
  return false;
}

function round(n: number, step = 1): number {
  return Math.round(n / step) * step;
}

/** Same reading box within measurement noise. Re-measuring on every
 *  page turn must not trigger a re-plan. */
export function profilesClose(a: PageProfile, b: PageProfile): boolean {
  return a.role === b.role && a.mode === b.mode
    && a.fontFamily === b.fontFamily && a.fontFeatureSettings === b.fontFeatureSettings
    && Math.abs(a.colWidth - b.colWidth) < 2
    && Math.abs(a.fontPx - b.fontPx) < 0.1
    && Math.abs(a.lineHeightPx - b.lineHeightPx) < 0.2
    && Math.abs(a.capLeftPlainPx - b.capLeftPlainPx) < 8
    && Math.abs(a.capRightPx - b.capRightPx) < 8
    && Math.abs(a.headNameFontPx - b.headNameFontPx) < 0.5
    && Math.abs(a.letterSpacingEm - b.letterSpacingEm) < 0.001
    && Math.abs(a.wordSpacingEm - b.wordSpacingEm) < 0.001;
}

export function profileSignature(p: PageProfile): string {
  return [
    p.role, p.mode, round(p.colWidth), round(p.fontPx, 0.25), round(p.lineHeightPx, 0.25),
    round(p.capLeftPlainPx, 4), round(p.capRightPx, 4), round(p.headNameFontPx), p.fontFamily.length,
  ].join(":");
}

export function planKey(bookId: string, mode: "single" | "double", profiles: PageProfile[], contentHash: string): string {
  return [bookId, mode, contentHash, ...profiles.map(profileSignature).sort()].join("|");
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
    mix(p.leftBody); mix(p.rightBody); mix(p.leftChapter ?? "");
    h = Math.imul(h ^ (isBreaker(p) ? 1 : 0), 16777619) >>> 0;
  }
  return `${pages.length}-${h.toString(36)}`;
}

/** Tokens of a run of source pages, in reading order. */
export function spreadTokens(pages: PlanPage[], from: number, toExcl: number): WordTok[] {
  const out: WordTok[] = [];
  for (let i = from; i < toExcl; i++) {
    const p = pages[i];
    if (!p) continue;
    for (const t of tokenizeHalf(p.leftBody)) out.push(t);
    for (const t of tokenizeHalf(p.rightBody)) out.push(t);
  }
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

class Measurer {
  private root: HTMLDivElement;
  private paras = new Map<string, HTMLParagraphElement>();
  private heads = new Map<string, HTMLDivElement>();

  constructor() {
    this.root = document.createElement("div");
    this.root.setAttribute("aria-hidden", "true");
    this.root.className = "nm-plan-measure";
    // Same horizontal box as the reader's word spans; one shared rule is
    // far cheaper than an inline style on every span.
    const style = document.createElement("style");
    style.textContent = ".nm-plan-measure p > span { padding: 0 3px; margin: 0 -1px; }";
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

  private para(p: PageProfile): HTMLParagraphElement {
    const sig = profileSignature(p);
    let el = this.paras.get(sig);
    if (!el) {
      el = document.createElement("p");
      Object.assign(el.style, {
        margin: "0", padding: "0",
        width: `${p.colWidth}px`,
        fontFamily: p.fontFamily,
        fontSize: `${p.fontPx}px`,
        lineHeight: `${p.lineHeightPx}px`,
        letterSpacing: `${p.letterSpacingEm}em`,
        wordSpacing: `${p.wordSpacingEm}em`,
        fontFeatureSettings: p.fontFeatureSettings,
        textAlign: "justify",
        hyphens: "manual",
        whiteSpace: "normal",
        overflowWrap: "normal",
      } as Partial<CSSStyleDeclaration>);
      el.style.setProperty("-webkit-hyphens", "manual");
      this.root.appendChild(el);
      this.paras.set(sig, el);
    }
    return el;
  }

  /** Start laying out a new spread candidate for one iPad's box. */
  begin(p: PageProfile): SpreadLayout {
    const el = this.para(p);
    el.textContent = "";
    return new SpreadLayout(el, p.lineHeightPx);
  }

  /** Height of the chapter heading block for `title`, mirroring the
   *  reader's heading (eyebrow, title, ornament, spacing). */
  headingPx(p: PageProfile, title: string): number {
    const sig = `${profileSignature(p)}|${title}`;
    let el = this.heads.get(sig);
    if (!el) {
      el = document.createElement("div");
      el.style.width = `${p.colWidth}px`;
      el.style.textAlign = "center";
      const parts = title.split(" · ");
      const num = parts.length > 1 ? parts[0] : null;
      const name = parts.length > 1 ? parts.slice(1).join(" · ") : title;
      if (num) {
        const n = document.createElement("span");
        Object.assign(n.style, { display: "block", fontFamily: "Merriweather, serif", fontSize: "10px", fontWeight: "700", letterSpacing: "0.22em", textTransform: "uppercase", marginBottom: "6px" });
        n.textContent = num;
        el.appendChild(n);
      }
      const t = document.createElement("span");
      Object.assign(t.style, { display: "block", fontFamily: "Playfair Display, serif", fontSize: `${p.headNameFontPx}px`, fontWeight: "700", lineHeight: "1.15", marginBottom: "4px" });
      t.textContent = name;
      el.appendChild(t);
      const orn = document.createElement("div");
      Object.assign(orn.style, { height: "9px", marginTop: "8px" });
      el.appendChild(orn);
      this.root.appendChild(el);
      this.heads.set(sig, el);
    }
    return el.offsetHeight + 12;
  }
}

/**
 * One spread candidate laid out on one iPad's box. Pages are appended
 * one at a time: with greedy line breaking, appending words never moves
 * words already laid out, so earlier line positions stay valid and each
 * extension only measures the new words.
 */
class SpreadLayout {
  readonly lineOf: number[] = [];
  private top0 = 0;
  private lastGlue = false;
  constructor(private el: HTMLParagraphElement, private lh: number) {}

  append(toks: WordTok[]) {
    if (toks.length === 0) return;
    const before = this.lineOf.length;
    let html = "";
    toks.forEach((t, i) => {
      if ((before > 0 || i > 0) && !this.lastGlue) html += " ";
      html += `<span>${escapeHtml(t.text)}</span>`;
      this.lastGlue = t.glue;
    });
    this.el.insertAdjacentHTML("beforeend", html);
    const spans = this.el.children;
    if (before === 0) this.top0 = (spans[0] as HTMLElement).offsetTop;
    for (let j = before; j < spans.length; j++) {
      this.lineOf.push(Math.round(((spans[j] as HTMLElement).offsetTop - this.top0) / this.lh));
    }
  }

  get count() { return this.lineOf.length; }
  get lines() { return this.lineOf.length ? Math.max(1, Math.round(this.el.offsetHeight / this.lh)) : 0; }

  /** Index of the first token on line `line` (or count if none). */
  firstOnLine(line: number): number {
    let lo = 0, hi = this.lineOf.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.lineOf[mid] >= line) hi = mid; else lo = mid + 1;
    }
    return lo;
  }
}

interface FitResult { fits: boolean; split: number }

interface Box { layout: SpreadLayout; capL: number; capR: number }

function startSpread(m: Measurer, profiles: PageProfile[], heading: string | null): Box[] {
  return profiles.map(p => {
    const lh = p.lineHeightPx;
    // A heading spread also carries a drop cap that narrows its first
    // lines; one extra line covers it.
    const headPx = heading ? m.headingPx(p, heading) + lh : 0;
    return {
      layout: m.begin(p),
      capL: Math.max(0, Math.floor((p.capLeftPlainPx - headPx) / lh)),
      capR: Math.max(0, Math.floor(p.capRightPx / lh) - RIGHT_SAFETY_LINES),
    };
  });
}

function evaluate(boxes: Box[]): FitResult {
  const count = boxes[0]?.layout.count ?? 0;
  if (count === 0) return { fits: true, split: 0 };
  const split = Math.min(...boxes.map(b => b.layout.firstOnLine(b.capL)));
  // Lines the right column needs on each iPad. Re-flowing from a fresh
  // line never needs more lines than the tail of the full layout.
  const fits = boxes.every(b => (split >= count ? 0 : b.layout.lines - b.layout.lineOf[split]) <= b.capR);
  return { fits, split };
}

export interface PlanInput {
  bookId: string;
  pages: PlanPage[];
  /** 1-based first pages of chapters (from book.chapters). */
  chapterStarts: Set<number>;
  mode: "single" | "double";
  profiles: PageProfile[];
  /** Plan the run containing this page first. */
  focusPage: number;
  /** The plan in use before this one (same book). Runs not re-planned
   *  yet keep its page groupings, so paging during a re-plan never jumps
   *  back to text already read. */
  previous?: PagePlan | null;
}

/**
 * Build the plan run by run, current run first, yielding to the UI
 * between runs. `onProgress` receives the plan so far (unplanned runs
 * fall back to one source page per spread). Resolves with the full plan,
 * or null if aborted.
 */
export async function buildPagePlan(
  input: PlanInput,
  onProgress: (plan: PagePlan, done: boolean) => void,
  isAborted: () => boolean,
): Promise<PagePlan | null> {
  const { pages, chapterStarts, profiles, mode, bookId } = input;
  const n = pages.length;
  const hash = contentHash(pages);
  const key = planKey(bookId, mode, profiles, hash);

  const cached = readCache(key);
  if (cached) {
    onProgress(cached, true);
    return cached;
  }

  // Runs: maximal sequences of mergeable pages.
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

  // Per run: list of [start(0-based), split]. Unplanned runs = identity.
  const planned = new Map<number, Array<[number, number]>>();
  const prevSplitAt = new Map<number, number>();
  if (input.previous && input.previous.bookId === bookId) {
    input.previous.starts.forEach((s, k) => prevSplitAt.set(s, input.previous!.splits[k] ?? -1));
  }
  const assemble = (done: boolean): PagePlan => {
    const starts: number[] = [];
    const splits: number[] = [];
    let plannedPages = 0;
    let plannedSpreads = 0;
    let unplannedPages = 0;
    runs.forEach(([a, b], r) => {
      const got = planned.get(r);
      if (got) {
        for (const [s, sp] of got) { starts.push(s + 1); splits.push(sp); }
        plannedPages += b - a;
        plannedSpreads += got.length;
      } else {
        if (prevSplitAt.has(a + 1)) {
          for (let i = a; i < b; i++) {
            const sp = prevSplitAt.get(i + 1);
            if (sp !== undefined) { starts.push(i + 1); splits.push(sp); }
          }
        } else {
          for (let i = a; i < b; i++) { starts.push(i + 1); splits.push(-1); }
        }
        unplannedPages += b - a;
      }
    });
    const plan: PagePlan = { bookId, key, mode, starts, splits };
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
      const out: Array<[number, number]> = [];
      let i = a;
      while (i < b) {
        const page = pages[i];
        if (isBreaker(page)) { out.push([i, -1]); i++; continue; }
        const heading = page.leftChapter ? page.leftChapter : null;
        const boxes = startSpread(m, profiles, heading);
        const pageToks = spreadTokens(pages, i, i + 1);
        boxes.forEach(bx => bx.layout.append(pageToks));
        let best = evaluate(boxes);
        let end = i + 1;
        while (end < b && end - i < MAX_MERGE) {
          const more = spreadTokens(pages, end, end + 1);
          boxes.forEach(bx => bx.layout.append(more));
          const res = evaluate(boxes);
          if (!res.fits) break;
          best = res;
          end++;
        }
        out.push([i, best.split]);
        i = end;
      }
      planned.set(r, out);
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
    const v = JSON.parse(raw) as PagePlan;
    if (!Array.isArray(v.starts) || !Array.isArray(v.splits) || v.starts.length !== v.splits.length) return null;
    return v;
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

/** Left and right column token runs for spread k, as source-half
 *  segments so every word keeps its stable id. */
export interface ColumnSegment {
  /** `${sourcePage}.${half}` */
  key: string;
  toks: WordTok[];
  /** Index of toks[0] within its half. */
  start: number;
}

export function composeSpread(
  pages: PlanPage[],
  startPage: number,
  endPageExcl: number,
  split: number,
): { leftSegs: ColumnSegment[]; rightSegs: ColumnSegment[] } {
  const halves: ColumnSegment[] = [];
  for (let src = startPage; src < endPageExcl; src++) {
    const p = pages[src - 1];
    if (!p) continue;
    const L = tokenizeHalf(p.leftBody);
    const R = tokenizeHalf(p.rightBody);
    if (L.length) halves.push({ key: `${src}.L`, toks: L, start: 0 });
    if (R.length) halves.push({ key: `${src}.R`, toks: R, start: 0 });
  }
  const count = endPageExcl - startPage;
  if (split < 0) {
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
      leftSegs.push({ key: h.key, toks: h.toks.slice(0, remaining), start: 0 });
      rightSegs.push({ key: h.key, toks: h.toks.slice(remaining), start: remaining });
      remaining = 0;
    } else {
      rightSegs.push(h);
    }
  }
  return { leftSegs, rightSegs };
}
