import { readFileSync } from "node:fs";
const text = readFileSync("src/App.tsx", "utf8");
const lines = text.split("\n");

// Match leftBody: '...' or rightBody: "..." with proper escape handling.
// Using a permissive matcher: capture from the prop name to the next
// unescaped matching quote.
function extract(line, name) {
  const re = new RegExp(name + ":\\s*(['\"])");
  const m = re.exec(line);
  if (!m) return null;
  const quote = m[1];
  const start = m.index + m[0].length;
  let i = start;
  while (i < line.length) {
    if (line[i] === "\\") { i += 2; continue; }
    if (line[i] === quote) {
      return line.slice(start, i);
    }
    i++;
  }
  return null;
}

const issues = [];
lines.forEach((line, idx) => {
  for (const name of ["leftBody", "rightBody"]) {
    const v = extract(line, name);
    if (v && v.length > 380) {
      issues.push({ line: idx + 1, side: name === "leftBody" ? "L" : "R", len: v.length });
    }
  }
});
issues.sort((a, b) => b.len - a.len);
console.log("Pages over 250 chars:", issues.length);
for (const i of issues) console.log(`  L${i.line} ${i.side} ${i.len}`);
