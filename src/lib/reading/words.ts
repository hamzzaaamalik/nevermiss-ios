/** A word token from a page half. `glue` = the next token follows with
 *  no space (an em dash joining two words, e.g. "word—another").
 *  `brk` = the word starts a new line (1) or a new paragraph (2): a line
 *  break or a blank line before it in the text. */
export interface WordTok { text: string; glue: boolean; brk?: 1 | 2 }

const cache = new Map<string, WordTok[]>();

/** Tokenize one page half. Every iPad tokenizes identically, so a token's
 *  index within its half is a stable identity across devices, page modes,
 *  font sizes and page merging. Line breaks never change the indices. */
export function tokenizeHalf(text: string | undefined | null): WordTok[] {
  if (!text) return [];
  const hit = cache.get(text);
  if (hit) return hit;
  const out: WordTok[] = [];
  const re = /(\s*)(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const newlines = out.length === 0 ? 0 : (m[1].match(/\n/g) ?? []).length;
    const brk: 1 | 2 | undefined = newlines >= 2 ? 2 : newlines === 1 ? 1 : undefined;
    const parts = m[2].replace(/([—–])(?=\S)/g, "$1\u0000").split("\u0000").filter(Boolean);
    parts.forEach((t, i) => out.push(i === 0 && brk ? { text: t, glue: i < parts.length - 1, brk } : { text: t, glue: i < parts.length - 1 }));
  }
  if (cache.size > 4000) cache.clear();
  cache.set(text, out);
  return out;
}

/** Paragraph indent, shared by the reader and the page planner. */
export const PARA_INDENT_EM = 1.5;
