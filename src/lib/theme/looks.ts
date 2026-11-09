/**
 * Looks: the app's colours (six choices) and the Library style (four choices).
 *
 * Every colour in the interface is written as `var(--lk-<token>, <Midnight colour>)`,
 * so Midnight is simply "no overrides" and looks exactly like the app before looks
 * existed. Any other look sets all the --lk-* variables at once on :root.
 *
 * The book page itself is not part of a look: it keeps its own Day / White / Sepia /
 * Night light (lib/reading/themes.ts). Video pictures, avatars and the red/green call
 * buttons are not part of a look either.
 */
import { LOOK_TOKENS } from "./tokens.gen";

export type LookId = "story" | "midnight" | "nook" | "sunny" | "heir" | "harbor";
export type LibraryStyle = "shelf" | "storefront" | "list" | "today";

export const LOOK_IDS: readonly LookId[] = ["story", "midnight", "harbor", "heir", "nook", "sunny"];
export const LIBRARY_STYLES: readonly LibraryStyle[] = ["shelf", "storefront", "list", "today"];
export const DEFAULT_LOOK: LookId = "story";
export const DEFAULT_LIBRARY_STYLE: LibraryStyle = "shelf";

export const LIBRARY_STYLE_META: Readonly<Record<LibraryStyle, { name: string; say: string }>> = {
  shelf:      { name: "Bookshelf",  say: "Covers on real shelves, grouped so each book is easy to find." },
  storefront: { name: "Storefront", say: "One big featured book, then rows of covers." },
  list:       { name: "Clean List", say: "Tidy rows with covers, for seeing the details at a glance." },
  today:      { name: "Classic",    say: "The list from before, with all the details on every row." },
};

/** The handful of colours each look is built from. Everything else is worked out from these. */
interface Palette {
  dark: boolean;
  bg: string;        // the app background
  deep: string;      // darker than the background (behind panels)
  raised: string;    // cards and rows
  raised2: string;   // a selected row, icon wells
  bar: string;       // top bar (lower edge) and drawers
  bar1: string;      // top bar (upper edge)
  ink: string;       // main text
  paper: string;     // a light chip or card that sits on the background
  accent: string;    // the brand colour as a fill (gold buttons, borders)
  accentHi: string;  // the bright end of the gold gradient
  accent2: string;   // the deep end of the gold gradient
  accentT: string;   // the brand colour as text (deeper on light looks so it can be read)
  accentHiT: string;
  onAccent: string;  // text on a gold button
  navyFill: string;  // a strong, dark surface
  shade: string;     // rgb of the dim layer behind pop-ups
  shadow: string;    // rgb of drop shadows
  okT: string; badT: string; badT2: string; infoT: string; infoT2: string;
  purpleT: string; violetT: string; warnT: string;
  /** Values for EXTRA_TOKENS (headings, rows, shelves, cover shadow). */
  extra: Record<string, string>;
}

export interface LookMeta { name: string; say: string; recommended?: boolean }

export const LOOK_META: Readonly<Record<LookId, LookMeta>> = {
  story:    { name: "Storybook",    say: "Cream paper, navy and gold, like your logo. Warm, bright and easy to read.", recommended: true },
  midnight: { name: "Midnight",     say: "Navy and gold. The NeverMiss look you know." },
  harbor:   { name: "Harbor",       say: "Crisp white and deep teal. Modern, clean and calm." },
  heir:     { name: "Heirloom",     say: "Burgundy and brass. Rich, like a leather-bound library." },
  nook:     { name: "Reading Nook", say: "Deep green and honey. Cosy for evening stories." },
  sunny:    { name: "Sunny Day",    say: "Sky blue and sunshine. Cheerful for little ones." },
};

const PALETTES: Readonly<Record<Exclude<LookId, "midnight">, Palette>> = {
  story: {
    dark: false, bg: "#F7F0E3", deep: "#E9DEC8", raised: "#FFFDF8", raised2: "#FBF0D6", bar: "#FBF5E8", bar1: "#FFFDF8",
    ink: "#1B2B4B", paper: "#FFFDF8",
    accent: "#C9922A", accentHi: "#E3AE45", accent2: "#D9951F", accentT: "#7A560B", accentHiT: "#7A560B",
    onAccent: "#1B2B4B", navyFill: "#E9DEC8", shade: "27,43,75", shadow: "60,40,20",
    okT: "#1B6B35", badT: "#A3241C", badT2: "#B3261E", infoT: "#1D5BB0", infoT2: "#1D5BB0",
    purpleT: "#6D35A8", violetT: "#5B3FB0", warnT: "#8F5500",
    extra: { "strong": "#14213D", "row": "#FFFDF8", "row-sel": "#FBF0D6", "niche-1": "rgba(92,60,28,0.13)", "niche-2": "rgba(92,60,28,0.03)", "shelf": "#BC8D5C", "shelf-2": "#8F6537", "cover-shadow": "0 10px 20px rgba(60,40,20,0.28), 0 2px 4px rgba(60,40,20,0.22)" },
  },
  harbor: {
    dark: false, bg: "#F5F7F8", deep: "#E3E9EC", raised: "#FFFFFF", raised2: "#E6F2F3", bar: "#FBFCFD", bar1: "#FFFFFF",
    ink: "#1E2F37", paper: "#FFFFFF",
    accent: "#0F6B73", accentHi: "#13808A", accent2: "#0E5F67", accentT: "#0E5F67", accentHiT: "#0E5F67",
    onAccent: "#FFFFFF", navyFill: "#E3E9EC", shade: "20,36,43", shadow: "15,40,50",
    okT: "#14663F", badT: "#A3241C", badT2: "#B3261E", infoT: "#1A5FB4", infoT2: "#1A5FB4",
    purpleT: "#6D35A8", violetT: "#5B3FB0", warnT: "#8F5500",
    extra: { "strong": "#14242B", "row": "#FFFFFF", "row-sel": "#E6F2F3", "niche-1": "rgba(15,60,70,0.08)", "niche-2": "rgba(15,60,70,0.015)", "shelf": "#B9A68E", "shelf-2": "#92806A", "cover-shadow": "0 10px 20px rgba(15,40,50,0.22), 0 2px 4px rgba(15,40,50,0.18)" },
  },
  sunny: {
    dark: false, bg: "#EAF6FD", deep: "#D3EAF7", raised: "#FFFFFF", raised2: "#FFF6D6", bar: "#F4FBFF", bar1: "#FFFFFF",
    ink: "#17375E", paper: "#FFFFFF",
    accent: "#FFC22E", accentHi: "#FFD84D", accent2: "#FFB52E", accentT: "#A8380F", accentHiT: "#A8380F",
    onAccent: "#17375E", navyFill: "#D3EAF7", shade: "16,41,74", shadow: "23,55,94",
    okT: "#156A41", badT: "#A3241C", badT2: "#B3261E", infoT: "#1A5FB4", infoT2: "#1A5FB4",
    purpleT: "#6D35A8", violetT: "#5B3FB0", warnT: "#8F5500",
    extra: { "strong": "#10294A", "row": "#FFFFFF", "row-sel": "#FFF6D6", "niche-1": "rgba(23,55,94,0.1)", "niche-2": "rgba(23,55,94,0.02)", "shelf": "#E3B27A", "shelf-2": "#C48F52", "cover-shadow": "0 10px 20px rgba(23,55,94,0.24), 0 2px 4px rgba(23,55,94,0.2)" },
  },
  heir: {
    dark: true, bg: "#1E0D12", deep: "#140709", raised: "#2A1319", raised2: "#3A1C23", bar: "#241016", bar1: "#2E141B",
    ink: "#F4E9DA", paper: "#F4E9DA",
    accent: "#C9A24F", accentHi: "#E9C98A", accent2: "#B98A3E", accentT: "#DDB56A", accentHiT: "#E9C98A",
    onAccent: "#2A1016", navyFill: "#2E141B", shade: "10,3,5", shadow: "0,0,0",
    okT: "#A6E8C1", badT: "#FFB3AB", badT2: "#FF8A80", infoT: "#9CC3F5", infoT2: "#B9D5F8",
    purpleT: "#D9B8F2", violetT: "#C9B8FA", warnT: "#F3B95F",
    extra: { "strong": "#FFF9EF", "row": "#2A1319", "row-sel": "#3A1C23", "niche-1": "rgba(0,0,0,0.34)", "niche-2": "rgba(0,0,0,0.1)", "shelf": "#6A3F28", "shelf-2": "#452717", "cover-shadow": "0 10px 22px rgba(0,0,0,0.55), 0 2px 4px rgba(0,0,0,0.4)" },
  },
  nook: {
    dark: true, bg: "#0F241D", deep: "#0A1914", raised: "#163228", raised2: "#21402F", bar: "#132B21", bar1: "#183429",
    ink: "#F5EFDF", paper: "#F5EFDF",
    accent: "#D9A23A", accentHi: "#F2C866", accent2: "#CF8E22", accentT: "#E3B04B", accentHiT: "#F2C866",
    onAccent: "#10261E", navyFill: "#183429", shade: "3,10,7", shadow: "0,0,0",
    okT: "#9BF0BB", badT: "#FCA5A5", badT2: "#F87171", infoT: "#7DD3FC", infoT2: "#A5E1FD",
    purpleT: "#D8B4FE", violetT: "#C4B5FD", warnT: "#FBBF24",
    extra: { "strong": "#FFFFFF", "row": "#163228", "row-sel": "#21402F", "niche-1": "rgba(0,0,0,0.3)", "niche-2": "rgba(0,0,0,0.08)", "shelf": "#7A5A36", "shelf-2": "#4F3921", "cover-shadow": "0 10px 22px rgba(0,0,0,0.5), 0 2px 4px rgba(0,0,0,0.4)" },
  },
};

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
};
const mix = (a: string, b: string, t: number) => {
  const pa = rgb(a).split(",").map(Number), pb = rgb(b).split(",").map(Number);
  const c = pa.map((v, i) => Math.max(0, Math.min(255, Math.round(v + (pb[i] - v) * t))));
  return "#" + c.map(v => v.toString(16).padStart(2, "0")).join("");
};
const round = (a: number) => Math.round(Math.min(1, Math.max(0, a)) * 1000) / 1000;

/** The same hue, dark enough to read on a light page (lightness about 30%). */
function deepShade(hex: string): string {
  const [r, g, b] = rgb(hex).split(",").map(v => Number(v) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  let h = 0;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  const S = Math.min(s, 0.75), L = 0.3;
  const c = (1 - Math.abs(2 * L - 1)) * S, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m0 = L - c / 2;
  const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return "#" + [r1, g1, b1].map(v => Math.round((v + m0) * 255).toString(16).padStart(2, "0")).join("");
}

/** The value of one --lk-* variable in one look. */
export function tokenValue(token: string, p: Palette): string {
  const m = token.match(/^(.*?)-(\d{3,4})$/);
  const fam = m ? m[1] : token;
  const a = m ? parseInt(m[2], 10) / 1000 : 1;
  const text = (x: number) => p.dark ? (x >= 0.25 ? 0.12 + 0.92 * x : x) : (x >= 0.25 ? 0.35 + 0.69 * x : x * 1.3);
  // On a light look a card is whiter than the page, not darker.
  const card = (x: number) => `rgba(${rgb(p.raised)},${round(0.5 + x * 2.5)})`;
  if (fam.startsWith("lt-")) {
    // A pale colour used as text: kept on dark looks, a deep shade of the same hue on light looks.
    const hex = "#" + fam.slice(3);
    if (p.dark) return m ? `rgba(${rgb(hex)},${round(a)})` : hex;
    const deep = deepShade(hex);
    return m ? `rgba(${rgb(deep)},${round(text(a))})` : deep;
  }
  // See-through families: the alpha itself changes with the look.
  switch (fam) {
    case "glass":     return p.dark ? `rgba(255,255,255,${round(a)})` : `rgba(${rgb(p.ink)},${round(a < 0.3 ? a * 1.35 : text(a))})`;
    case "fill":      return p.dark ? `rgba(255,255,255,${round(a)})` : card(a);
    case "line":      return p.dark ? `rgba(255,255,255,${round(a)})` : `rgba(${rgb(p.ink)},${round(a < 0.3 ? a * 1.5 : text(a))})`;
    case "inkfill":   return p.dark ? `rgba(${rgb(p.ink)},${round(a)})` : card(a);
    case "ink":       if (m) return `rgba(${rgb(p.ink)},${round(text(a))})`; break;
    case "deep":      if (m) return p.dark ? `rgba(${rgb(p.deep)},${round(a)})` : `rgba(${p.shade},${round(a * 0.65)})`; break;
    case "shadow":    return `rgba(${p.shadow},${round(p.dark ? a : a * 0.55)})`;
    // See-through amber used as text: the deeper amber, and less see-through on light looks.
    case "accent-t":    if (m) return `rgba(${rgb(p.accentT)},${round(p.dark ? a : text(a))})`; break;
    case "accent-hi-t": if (m) return `rgba(${rgb(p.accentHiT)},${round(p.dark ? a : text(a))})`; break;
  }
  // Everything else is one solid colour; a "-950" style suffix makes it see-through at that alpha.
  const solid = solidValue(fam, p);
  if (!solid) return LOOK_TOKENS[token] ?? "";
  return m && solid.startsWith("#") ? `rgba(${rgb(solid)},${round(a)})` : solid;
}

function solidValue(fam: string, p: Palette): string {
  if (p.extra[fam]) return p.extra[fam];
  switch (fam) {
    case "track":     return p.dark ? "rgba(255,255,255,0.18)" : `rgba(${rgb(p.ink)},0.22)`;
    case "stage":     return p.dark ? "#000" : p.bg;   // the base of the video screens
    case "ink":       return p.ink;
    case "accent":    return p.accent;
    case "accent-hi": return p.accentHi;
    case "accent-2":  return p.accent2;
    case "accent-t":  return p.accentT;
    case "accent-hi-t": return p.accentHiT;
    case "bg":        return p.bg;
    case "deep":      return p.deep;
    case "navy":      return p.onAccent;
    case "on-accent-0b": return p.onAccent;
    case "navy-fill": return p.navyFill;
    case "bar-1":     return p.bar1;
    case "paper":     return p.paper;
    case "n-162240": case "n-13213d": return p.raised;
    case "n-14264a":  return p.raised2;
    case "n-14223e":  return p.bar;
    case "n-0d1e38": case "n-0f1d36": case "n-0d1d3c": case "n-0f1b32": return mix(p.bg, p.raised, 0.5);
    case "n-0d1424":  return mix(p.bg, p.deep, 0.5);
    case "n-223a6e":  return p.dark ? mix(p.raised, "#3B82F6", 0.22) : mix(p.raised, "#3B82F6", 0.12);
    case "ok-t":      return p.okT;
    case "bad-t":     return p.badT;
    case "bad-t2":    return p.badT2;
    case "info-t":    return p.infoT;
    case "info-t2":   return p.infoT2;
    case "purple-t":  return p.purpleT;
    case "violet-t":  return p.violetT;
    case "warn-t":    return p.warnT;
    default:          return "";
  }
}

/** Colours used only by the newer screens (the cover Library styles), with their Midnight values. */
export const EXTRA_TOKENS: Readonly<Record<string, string>> = {
  "strong": "#FFFFFF", "row": "#131F35", "row-sel": "#1D232D",
  "niche-1": "rgba(0,0,0,0.34)", "niche-2": "rgba(0,0,0,0.1)", "shelf": "#6A5138", "shelf-2": "#46331F",
  "cover-shadow": "0 10px 22px rgba(0,0,0,0.5), 0 2px 4px rgba(0,0,0,0.4)",
};

/** Every variable for a look. Midnight needs none: the fallbacks are Midnight. */
export function lookVariables(look: LookId): Record<string, string> {
  if (look === "midnight") return {};
  const p = PALETTES[look];
  const out: Record<string, string> = {};
  for (const token of Object.keys(LOOK_TOKENS)) out[`--lk-${token}`] = tokenValue(token, p);
  for (const token of Object.keys(EXTRA_TOKENS)) out[`--lk-${token}`] = p.extra[token] ?? EXTRA_TOKENS[token];
  return out;
}

export const isLookId = (v: unknown): v is LookId => typeof v === "string" && (LOOK_IDS as readonly string[]).includes(v);
export const isLibraryStyle = (v: unknown): v is LibraryStyle => typeof v === "string" && (LIBRARY_STYLES as readonly string[]).includes(v);

/** The few colours a look's picker card shows as its little preview. */
export function lookSwatch(look: LookId): { bg: string; raised: string; ink: string; accent: string; accentHi: string; line: string } {
  if (look === "midnight") return { bg: "#0b172e", raised: "#162240", ink: "#F7F0E3", accent: "#C9922A", accentHi: "#f7c95d", line: "rgba(255,255,255,0.12)" };
  const p = PALETTES[look];
  return { bg: p.bg, raised: p.raised, ink: p.ink, accent: p.accent, accentHi: p.accentHi, line: p.dark ? "rgba(255,255,255,0.12)" : `rgba(${rgb(p.ink)},0.16)` };
}

export function lookBackground(look: LookId): string { return look === "midnight" ? "#0b172e" : PALETTES[look].bg; }
export function lookIsDark(look: LookId): boolean { return look === "midnight" || PALETTES[look].dark; }

// ─── Applying and remembering the choice ────────────────────────────

const LOOK_KEY = "nm_look";
const STYLE_KEY = "nm_library_style";
let current: { look: LookId; style: LibraryStyle } = { look: DEFAULT_LOOK, style: DEFAULT_LIBRARY_STYLE };
const listeners = new Set<() => void>();

function readSaved(): { look: LookId; style: LibraryStyle } {
  let look: LookId = DEFAULT_LOOK, style: LibraryStyle = DEFAULT_LIBRARY_STYLE;
  try {
    const l = localStorage.getItem(LOOK_KEY); if (isLookId(l)) look = l;
    const s = localStorage.getItem(STYLE_KEY); if (isLibraryStyle(s)) style = s;
  } catch { /* storage blocked: use the defaults */ }
  return { look, style };
}

/** Paint a look: one <style> on :root, the page colour behind the app, and the status-bar colour. */
export function paintLook(look: LookId): void {
  if (typeof document === "undefined") return;
  const vars = lookVariables(look);
  let el = document.getElementById("nm-look") as HTMLStyleElement | null;
  if (!el) { el = document.createElement("style"); el.id = "nm-look"; document.head.appendChild(el); }
  el.textContent = look === "midnight" ? "" : `:root{${Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(";")}}`;
  const root = document.documentElement;
  root.dataset.look = look;
  root.style.colorScheme = lookIsDark(look) ? "dark" : "light";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", lookBackground(look));
}

const INTRO_KEY = "nm_looks_intro";

/** Call once, before the app draws, so the first frame is already in the right look. */
export function startLooks(): void {
  current = readSaved();
  paintLook(current.look);
  // An iPad that used NeverMiss before looks existed gets the one-time "new look"
  // card on Nana's Home (with a way back); a new install just starts in the default.
  try {
    if (localStorage.getItem(INTRO_KEY) === null) {
      const usedBefore = localStorage.getItem("nm_device_view") !== null && localStorage.getItem(LOOK_KEY) === null;
      localStorage.setItem(INTRO_KEY, usedBefore ? "pending" : "done");
    }
  } catch { /* storage blocked: no card */ }
}

export function looksIntroPending(): boolean {
  try { return localStorage.getItem(INTRO_KEY) === "pending"; } catch { return false; }
}
export function finishLooksIntro(): void {
  try { localStorage.setItem(INTRO_KEY, "done"); } catch { /* fine */ }
}

export function getLook(): LookId { return current.look; }
export function getLibraryStyle(): LibraryStyle { return current.style; }

/** Change the look and/or Library style on this iPad (and remember it here). */
export function setLooks(next: { look?: LookId; style?: LibraryStyle }): void {
  const look = next.look && isLookId(next.look) ? next.look : current.look;
  const style = next.style && isLibraryStyle(next.style) ? next.style : current.style;
  if (look === current.look && style === current.style) return;
  const lookChanged = look !== current.look;
  current = { look, style };
  try { localStorage.setItem(LOOK_KEY, look); localStorage.setItem(STYLE_KEY, style); } catch { /* not remembered */ }
  if (lookChanged) paintLook(look);
  listeners.forEach(fn => fn());
}

export function subscribeLooks(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
