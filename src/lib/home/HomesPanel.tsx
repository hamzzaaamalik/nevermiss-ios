import { useState } from "react";
import type { Child } from "../api";

/**
 * Settings › Homes (Build 44, Rick's Build 43 note): a grandparent whose
 * grandchildren live in different homes gives each home its own family
 * code, so each home's iPad sees only its own grandchildren and has its
 * own visit. Nana still sees every grandchild together on Home.
 */
export interface HomeEntry {
  id: string;
  name: string | null;
  inviteToken: string;
  children: Child[];
}

const FONT = "DM Sans, sans-serif";
const SERIF = "Playfair Display, serif";
const CREAM = "var(--lk-ink, #F7F0E3)";
const AMBER_T = "var(--lk-accent-t, #C9922A)";
const AMBER = "var(--lk-accent, #C9922A)";
const NAVY = "var(--lk-navy, #1B2B4B)";

/** "The Smiths", or the grandchildren's names when the home has no name. */
export function homeLabel(h: { name: string | null; children: Child[] }): string {
  if (h.name) return h.name;
  const names = h.children.map(c => c.name);
  if (names.length === 0) return "New home";
  if (names.length === 1) return `${names[0]}'s home`;
  if (names.length === 2) return `${names[0]} & ${names[1]}'s home`;
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}'s home`;
}

const btn: React.CSSProperties = {
  minHeight: 44, padding: "0 16px", borderRadius: 999,
  background: "var(--lk-fill-060, rgba(255,255,255,0.06))", border: "1px solid var(--lk-accent-500, rgba(201,146,42,0.5))",
  color: CREAM, fontFamily: FONT, fontSize: 15, fontWeight: 700, cursor: "pointer", touchAction: "manipulation",
};
const input: React.CSSProperties = {
  minHeight: 46, padding: "0 14px", borderRadius: 12, flex: "1 1 220px", minWidth: 0,
  background: "var(--lk-fill-060, rgba(255,255,255,0.06))", border: "1px solid var(--lk-line-250, rgba(255,255,255,0.25))",
  color: CREAM, fontFamily: FONT, fontSize: 16,
};

function CodeRow({ code, testId }: { code: string; testId: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <span data-testid={testId} style={{ color: AMBER_T, fontFamily: FONT, fontSize: 26, fontWeight: 900, letterSpacing: "0.2em" }}>{code}</span>
      <button
        type="button"
        style={btn}
        onClick={() => { void navigator.clipboard?.writeText(code).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 2500); }).catch(() => {}); }}
      >{copied ? "Copied ✓" : "📋 Copy"}</button>
    </div>
  );
}

export function HomesPanel({ homes, activeId, onAddHome, onRename, onMoveChild, onNewCode }: {
  homes: HomeEntry[];
  activeId: string | null;
  onAddHome: (name: string) => Promise<void>;
  onRename: (homeId: string, name: string) => Promise<void>;
  onMoveChild: (childId: string, toHomeId: string) => Promise<void>;
  /** A new code for one home (the old one stops working for new iPads). */
  onNewCode?: (homeId: string) => Promise<void>;
}) {
  const [askNew, setAskNew] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameTo, setRenameTo] = useState("");
  const [moving, setMoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);

  const run = async (fn: () => Promise<void>, ok: string) => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try { await fn(); setMsg({ text: ok }); }
    catch (e) { setMsg({ text: e instanceof Error ? e.message : "That didn't work. Try again.", bad: true }); }
    finally { setBusy(false); }
  };

  const several = homes.length > 1;
  return (
    <div data-testid="settings-homes" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {several && (
        <div style={{ color: "var(--lk-ink-750, rgba(247,240,227,0.75))", fontFamily: FONT, fontSize: 15, lineHeight: 1.5 }}>
          Each home has its own family code. Enter it on the iPad in that home, and the grandchildren there sign in with their own picture and PIN. You see everyone together on Home. To move a grandchild to another home, tap their name.
        </div>
      )}
      {several && homes.map(h => (
        <div key={h.id} data-testid={`home-card-${h.id}`} style={{
          padding: "14px 16px", borderRadius: 16, display: "flex", flexDirection: "column", gap: 10,
          background: "var(--lk-fill-050, rgba(255,255,255,0.05))",
          border: `1px solid ${h.id === activeId ? "var(--lk-accent-550, rgba(201,146,42,0.55))" : "var(--lk-line-140, rgba(255,255,255,0.14))"}`,
        }}>
          {renaming === h.id ? (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <input aria-label="Name of this home" data-testid="home-rename-input" style={input} value={renameTo} maxLength={40} autoFocus onChange={e => setRenameTo(e.target.value)} placeholder="For example: The Smiths" />
              <button type="button" style={btn} onClick={() => setRenaming(null)}>Cancel</button>
              <button type="button" data-testid="home-rename-save" disabled={busy} style={{ ...btn, background: AMBER, color: NAVY, border: "none" }}
                onClick={() => void run(async () => { await onRename(h.id, renameTo); setRenaming(null); }, "Saved.")}>Save</button>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <span data-testid="home-name" style={{ color: CREAM, fontFamily: SERIF, fontSize: 21, fontWeight: 700 }}>{homeLabel(h)}</span>
              <button type="button" data-testid="home-rename" style={btn} onClick={() => { setRenaming(h.id); setRenameTo(h.name ?? ""); setMsg(null); }}>Rename</button>
            </div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {h.children.length === 0 && (
              <span style={{ color: "var(--lk-ink-600, rgba(247,240,227,0.6))", fontFamily: FONT, fontSize: 15 }}>No grandchildren here yet. Move one here, or add one from this home's iPad.</span>
            )}
            {h.children.map(c => (
              <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button
                  type="button"
                  data-testid={`home-move-${c.name}`}
                  onClick={() => setMoving(moving === c.id ? null : c.id)}
                  aria-expanded={moving === c.id}
                  style={{ ...btn, minHeight: 40, padding: "0 14px", border: "1px solid var(--lk-line-250, rgba(255,255,255,0.25))" }}
                >{c.name} <span aria-hidden style={{ opacity: 0.6, marginLeft: 4 }}>⇄</span></button>
                {moving === c.id && homes.filter(o => o.id !== h.id).map(o => (
                  <button key={o.id} type="button" data-testid={`home-move-to-${o.id}`} disabled={busy}
                    style={{ ...btn, minHeight: 40, background: AMBER, color: NAVY, border: "none" }}
                    onClick={() => void run(async () => { await onMoveChild(c.id, o.id); setMoving(null); }, `${c.name} moved to ${homeLabel(o)}.`)}>
                    Move to {homeLabel(o)}
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <CodeRow code={h.inviteToken} testId={`home-code-${h.id}`} />
            {onNewCode && askNew !== h.id && (
              <button type="button" data-testid={`home-new-code-${h.id}`} style={btn} onClick={() => { setAskNew(h.id); setMsg(null); }}>Make a new code</button>
            )}
          </div>
          {onNewCode && askNew === h.id && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ color: CREAM, fontFamily: FONT, fontSize: 15, lineHeight: 1.5, flex: "1 1 260px" }}>
                The old code will stop working for new iPads. iPads already set up stay connected.
              </span>
              <button type="button" style={btn} onClick={() => setAskNew(null)}>Keep this code</button>
              <button type="button" data-testid={`home-new-code-ok-${h.id}`} disabled={busy} style={{ ...btn, background: AMBER, color: NAVY, border: "none" }}
                onClick={() => void run(async () => { await onNewCode(h.id); setAskNew(null); }, `${homeLabel(h)} has a new family code.`)}>Make a new code</button>
            </div>
          )}
        </div>
      ))}
      {adding ? (
        <div data-testid="home-add-form" style={{ padding: "14px 16px", borderRadius: 16, display: "flex", flexDirection: "column", gap: 10, background: "var(--lk-fill-050, rgba(255,255,255,0.05))", border: "1px solid var(--lk-line-140, rgba(255,255,255,0.14))" }}>
          <div style={{ color: CREAM, fontFamily: FONT, fontSize: 16, lineHeight: 1.5 }}>
            Another home gets its own family code. Grandchildren in that home use it on their iPad.
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input aria-label="Name of the new home" data-testid="home-add-name" style={input} value={newName} maxLength={40} autoFocus onChange={e => setNewName(e.target.value)} placeholder="For example: Cooper and Perry's house" />
            <button type="button" style={btn} onClick={() => setAdding(false)}>Cancel</button>
            <button type="button" data-testid="home-add-save" disabled={busy || !newName.trim()} style={{ ...btn, background: AMBER, color: NAVY, border: "none", opacity: newName.trim() ? 1 : 0.5 }}
              onClick={() => void run(async () => { await onAddHome(newName); setAdding(false); setNewName(""); }, "The new home is ready. Its family code is shown above.")}>Add home</button>
          </div>
        </div>
      ) : (
        <button type="button" data-testid="home-add" style={{ ...btn, alignSelf: "flex-start" }} onClick={() => { setAdding(true); setMsg(null); }}>
          + Add another home
        </button>
      )}
      {msg && <div role="status" data-testid="homes-msg" style={{ color: msg.bad ? "var(--lk-bad-t, #fca5a5)" : "var(--lk-ok-t, #86efac)", fontFamily: FONT, fontSize: 14 }}>{msg.text}</div>}
    </div>
  );
}
