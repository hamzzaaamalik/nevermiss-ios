// Nana's prompts are read straight to the child (Rick's Build 39 E1): "Do
// you think the star of the story will be happy?", not "Ask: do you
// think…". Prompts written before that (the AI ones, hand-written ones in
// the admin, the built-in books) often start with "Ask:" or "Ask Perry:"
// and add a line coaching the grandparent ("Remind them you would always
// come running"). spokenPrompt() keeps only what is said to the child.

const WHO = String.raw`(?:them|him|her|your\s+grand(?:child|son|daughter)|the\s+child|[A-Z][\w'’-]*)`;
// "Ask:", "Ask Perry:", "Then ask her:" at the start of a sentence.
const LEAD = new RegExp(String.raw`^(?:and\s+|then\s+|now\s+)?ask(?:\s+${WHO})?\s*:\s*`, "i");
// "Carroll made up 'curiouser', ask Perry: do you…" inside a sentence.
const MID = new RegExp(String.raw`\s*(?:[,;–—]|\s-)\s*(?:and\s+|then\s+)?ask(?:\s+${WHO})?\s*:\s*`, "i");
// Sentences meant for the grandparent: "Tell her about…", "Share one of
// yours.", "Ask Perry to close her eyes…", "Ask if that's ever happened…".
const COACH = new RegExp(String.raw`^(?:and\s+|then\s+)?(?:tell\s+${WHO}|share\b|remind\b|encourage\b|explain\b|ask\s+(?:if|whether|about)\b|ask\s+${WHO}\s+(?:to|if|whether|about)\b|you\s+(?:can|could|might)\s+(?:also\s+)?share\b)`, "i");

const SENTENCE = /[^.!?]+(?:[.!?]+["'”’)]*|$)/g;

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The prompt as words for the child; the original (minus "Ask:") when
 *  every sentence was coaching, so nothing Nana wrote is lost. */
export function spokenPrompt(raw: string | null | undefined): string {
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const sentences = (text.replace(MID, ". ").match(SENTENCE) ?? [text])
    .map(s => s.trim())
    .filter(Boolean);
  const kept = sentences
    .filter(s => !COACH.test(s))
    .map(s => capital(s.replace(LEAD, "")))
    .filter(Boolean);
  if (kept.length > 0) return kept.join(" ");
  return capital(text.replace(LEAD, ""));
}
