/**
 * Build 44: Library filters the admin defines (GET /api/filters). Kept on
 * this iPad so the Library shows them at once on the next launch. Without
 * them (an older server, or the first launch offline) the Library shows
 * the age buttons it always had.
 */
import { useSyncExternalStore } from "react";

export interface FilterChoiceDef {
  id: string;
  label: string;
  emoji: string;
  color: string | null;
  automatic: boolean;
  /** Ages: matched on the book's age, as the Library always did. */
  age?: string;
}
export interface FilterGroupDef {
  id: string;
  name: string;
  emoji: string;
  pinned: boolean;
  builtin: "age" | null;
  choices: FilterChoiceDef[];
}
export interface FilterDefs {
  groups: FilterGroupDef[];
  /** Group the cover Library styles' shelves by (null: by age). */
  shelvesBy: string | null;
}

/** The Library's age buttons before Build 44 (and with an older server). */
export const LEGACY_AGE_GROUP: FilterGroupDef = {
  id: "ages", name: "Ages", emoji: "", pinned: true, builtin: "age",
  choices: ["4-5", "5-7", "7-10", "10-13"].map(a => ({ id: `age-${a}`, label: `Ages ${a.replace("-", "–")}`, emoji: "", color: null, automatic: true, age: a })),
};

const KEY = "nm_filter_defs_v1";
const str = (v: unknown, max = 60) => (typeof v === "string" ? v.slice(0, max) : "");

/** A defensive copy of what the server sent (null when it isn't usable). */
export function parseFilterDefs(raw: unknown): FilterDefs | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.groups)) return null;
  const groups: FilterGroupDef[] = [];
  for (const g of r.groups.slice(0, 30)) {
    if (!g || typeof g !== "object") continue;
    const gg = g as Record<string, unknown>;
    const id = str(gg.id, 80), name = str(gg.name);
    if (!id || !name || !Array.isArray(gg.choices)) continue;
    const choices: FilterChoiceDef[] = [];
    for (const ch of gg.choices.slice(0, 60)) {
      if (!ch || typeof ch !== "object") continue;
      const c = ch as Record<string, unknown>;
      const cid = str(c.id, 80), label = str(c.label);
      if (!cid || !label) continue;
      choices.push({
        id: cid, label, emoji: str(c.emoji, 8),
        color: typeof c.color === "string" && /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : null,
        automatic: c.automatic === true,
        ...(typeof c.age === "string" && /^\d+-\d+$/.test(c.age) ? { age: c.age } : {}),
      });
    }
    groups.push({ id, name, emoji: str(gg.emoji, 8), pinned: gg.pinned === true, builtin: gg.builtin === "age" ? "age" : null, choices });
  }
  return { groups, shelvesBy: typeof r.shelvesBy === "string" && r.shelvesBy ? r.shelvesBy.slice(0, 80) : null };
}

let defs: FilterDefs | null = (() => {
  try { return parseFilterDefs(JSON.parse(localStorage.getItem(KEY) ?? "null")); } catch { return null; }
})();
const subs = new Set<() => void>();

export function setFilterDefs(next: FilterDefs | null): void {
  if (JSON.stringify(next) === JSON.stringify(defs)) return;
  defs = next;
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next));
    else localStorage.removeItem(KEY);
  } catch { /* not kept */ }
  for (const f of subs) f();
}
export function getFilterDefs(): FilterDefs | null { return defs; }
export function useFilterDefs(): FilterDefs | null {
  return useSyncExternalStore(
    (f) => { subs.add(f); return () => { subs.delete(f); }; },
    () => defs,
  );
}

/** The groups the Library shows: the admin's, or the old age buttons. */
export function libraryGroups(d: FilterDefs | null): FilterGroupDef[] {
  if (!d) return [LEGACY_AGE_GROUP];
  return d.groups.filter(g => g.choices.length > 0);
}

/** Does a book belong to a choice? Ages compare the book's age (bundled books know it too). */
export function bookInChoice(book: { ageRange?: string; filterChoices?: string[] }, choice: FilterChoiceDef): boolean {
  if (choice.age) return (book.ageRange ?? "").toLowerCase().replace(/[–—]/g, "-").includes(choice.age);
  return !!book.filterChoices?.includes(choice.id);
}

/** Every chosen choice (one per group) must match. Unknown choices are ignored. */
export function bookMatchesChoices(book: { ageRange?: string; filterChoices?: string[] }, sel: Record<string, string>, groups: FilterGroupDef[]): boolean {
  for (const [gid, cid] of Object.entries(sel)) {
    const ch = groups.find(g => g.id === gid)?.choices.find(c => c.id === cid);
    if (ch && !bookInChoice(book, ch)) return false;
  }
  return true;
}

/** Choices by group from a mirrored message: the new `choices`, or an older iPad's `age`. */
export function choicesFromMirror(p: { age?: unknown; choices?: unknown }, groups: FilterGroupDef[]): Record<string, string> {
  if (p.choices && typeof p.choices === "object" && !Array.isArray(p.choices)) {
    const out: Record<string, string> = {};
    for (const [g, c] of Object.entries(p.choices as Record<string, unknown>).slice(0, 30)) if (typeof c === "string") out[g.slice(0, 80)] = c.slice(0, 80);
    return out;
  }
  if (typeof p.age === "string" && p.age !== "any") {
    for (const g of groups) {
      const ch = g.choices.find(c => c.age === p.age);
      if (ch) return { [g.id]: ch.id };
    }
  }
  return {};
}

/** The age an older iPad understands, from the chosen choices. */
export function legacyAge(sel: Record<string, string>, groups: FilterGroupDef[]): "any" | "4-5" | "5-7" | "7-10" | "10-13" {
  for (const [gid, cid] of Object.entries(sel)) {
    const a = groups.find(g => g.id === gid)?.choices.find(c => c.id === cid)?.age;
    if (a === "4-5" || a === "5-7" || a === "7-10" || a === "10-13") return a;
  }
  return "any";
}
