/** A word token from a page half. `glue` = the next token follows with
 *  no space (an em dash joining two words, e.g. "word—another"). */
export interface WordTok { text: string; glue: boolean }

const cache = new Map<string, WordTok[]>();

/** Tokenize one page half. Every iPad tokenizes identically, so a token's
 *  index within its half is a stable identity across devices, page modes,
 *  font sizes and page merging. */
export function tokenizeHalf(text: string | undefined | null): WordTok[] {
  if (!text) return [];
  const hit = cache.get(text);
  if (hit) return hit;
  const out: WordTok[] = [];
  for (const raw of text.split(/\s+/)) {
    if (!raw) continue;
    const parts = raw.replace(/([—–])(?=\S)/g, "$1\u0000").split("\u0000").filter(Boolean);
    parts.forEach((t, i) => out.push({ text: t, glue: i < parts.length - 1 }));
  }
  if (cache.size > 4000) cache.clear();
  cache.set(text, out);
  return out;
}
