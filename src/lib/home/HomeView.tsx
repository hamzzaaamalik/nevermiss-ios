import { useEffect, useState, type CSSProperties } from "react";
import type { Child } from "../api";
import { compressPhoto, pickPhotoFile } from "./photo";

const NAVY = "#1B2B4B";
const AMBER = "#C9922A";
const CREAM = "#F7F0E3";
const FONT = "DM Sans, sans-serif";
const SERIF = "Playfair Display, serif";

const AVATAR_COLORS = ["#3b82f6", "#a855f7", "#14b8a6", "#f97316", "#ec4899", "#22c55e"];
function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

/** A grandchild's face: their photo, or a warm initial when there isn't one. */
export function ChildAvatar({ child, size, ring, style }: { child: Pick<Child, "id" | "name" | "photoUrl">; size: number; ring?: "selected" | "plain" | "none"; style?: CSSProperties }) {
  const r = ring ?? "none";
  const border = r === "selected" ? `${Math.max(4, Math.round(size / 36))}px solid ${AMBER}` : r === "plain" ? "2px solid rgba(255,255,255,0.35)" : "none";
  const shadow = r === "selected" ? "0 0 0 6px rgba(201,146,42,0.18), 0 14px 40px rgba(201,146,42,0.35)" : "0 8px 24px rgba(0,0,0,0.35)";
  const base: CSSProperties = {
    width: size, height: size, borderRadius: "50%", flexShrink: 0,
    border, boxShadow: shadow, boxSizing: "border-box",
    ...style,
  };
  if (child.photoUrl) {
    return <img src={child.photoUrl} alt="" draggable={false} style={{ ...base, objectFit: "cover", display: "block", background: "#0d1424" }} />;
  }
  return (
    <div aria-hidden style={{
      ...base,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: `linear-gradient(135deg, ${colorFor(child.id)} 0%, ${colorFor(child.id + "x")} 100%)`,
      color: "#fff", fontFamily: SERIF, fontWeight: 700, fontSize: Math.round(size * 0.42),
    }}>
      {(child.name.trim()[0] ?? "★").toUpperCase()}
    </div>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function formatNext(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(d) - startOf(new Date())) / 86_400_000);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} · ${time}`;
}

/**
 * Home (Master Plan §3, Build 38): the grandchildren are the screen.
 * Big photos with names, one obvious button, nothing else competing.
 * Every other destination lives in the Menu.
 */
export function HomeView({
  nanaName,
  children,
  activeChildId,
  onSelectChild,
  perryOnline,
  perryHereChildId,
  nextVisitIso,
  continueBook,
  visitActive,
  onPrimary,
  onAddChild,
  onSetPhoto,
  loading,
}: {
  nanaName: string;
  children: Child[];
  activeChildId: string | null;
  onSelectChild: (id: string) => void;
  perryOnline: boolean;
  /** Who is logged in on the child's iPad right now, if anyone. */
  perryHereChildId: string | null;
  nextVisitIso: string | null;
  /** The selected child's book in progress. */
  continueBook: { title: string; emoji: string } | null;
  /** A visit is live (Nana came Home mid-call). */
  visitActive: boolean;
  onPrimary: () => void;
  onAddChild: () => void;
  onSetPhoto: (childId: string, dataUrl: string) => Promise<void>;
  loading?: boolean;
}) {
  const [photoBusy, setPhotoBusy] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState("");
  useEffect(() => {
    if (!photoError) return;
    const t = window.setTimeout(() => setPhotoError(""), 6000);
    return () => window.clearTimeout(t);
  }, [photoError]);

  const active = children.find(c => c.id === activeChildId) ?? children[0] ?? null;
  const n = children.length;
  const size = n <= 1 ? 230 : n === 2 ? 190 : n === 3 ? 160 : 132;
  const name = active?.name ?? "your grandchild";
  const here = perryOnline && (!perryHereChildId || perryHereChildId === active?.id);
  const otherHere = perryOnline && perryHereChildId && active && perryHereChildId !== active.id
    ? children.find(c => c.id === perryHereChildId) ?? null
    : null;
  const next = nextVisitIso ? formatNext(nextVisitIso) : "";

  const addPhoto = async (child: Child) => {
    setPhotoError("");
    const file = await pickPhotoFile();
    if (!file) return;
    setPhotoBusy(child.id);
    try {
      const dataUrl = await compressPhoto(file);
      await onSetPhoto(child.id, dataUrl);
    } catch (e) {
      setPhotoError(e instanceof Error ? e.message : "Couldn't save that picture.");
    } finally {
      setPhotoBusy(null);
    }
  };

  return (
    <div data-testid="home-view" style={{
      flex: 1, minHeight: 0, overflowY: "auto",
      display: "flex", flexDirection: "column", alignItems: "center",
      padding: "28px 20px 32px",
      backgroundColor: "#0b172e",
      backgroundImage: "radial-gradient(900px 520px at 50% -10%, rgba(247,201,93,0.16), transparent 70%), radial-gradient(700px 420px at 100% 110%, rgba(96,165,250,0.10), transparent 70%)",
    }}>
      <style>{`
        .nm-home-kid { transition: transform 220ms cubic-bezier(0.22,1,0.36,1), opacity 220ms ease; }
        .nm-home-kid:active { transform: scale(0.97); }
        .nm-home-cta:active { transform: scale(0.98); }
        @keyframes nm-home-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
        @keyframes nm-here-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(134,239,172,0.55); } 50% { box-shadow: 0 0 0 7px rgba(134,239,172,0); } }
      `}</style>

      <div style={{ flex: "1 1 0", minHeight: 8, maxHeight: 60 }} />

      <div style={{ color: "rgba(247,240,227,0.7)", fontFamily: FONT, fontSize: 18, fontWeight: 600, letterSpacing: "0.01em", animation: "nm-home-in 0.4s ease-out both" }}>
        {greeting()}, {nanaName || "Nana"}
      </div>

      {loading && children.length === 0 ? (
        <div style={{ color: "rgba(247,240,227,0.6)", fontFamily: FONT, fontSize: 18, marginTop: 40 }}>Loading…</div>
      ) : children.length === 0 ? (
        <div style={{ marginTop: 36, display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <div style={{ color: CREAM, fontFamily: SERIF, fontSize: 30, fontWeight: 700, textAlign: "center" }}>Add your first grandchild</div>
          <button type="button" onClick={onAddChild} className="nm-home-cta" style={ctaStyle(true)}>+ Add a grandchild</button>
        </div>
      ) : (
        <>
          <div role="radiogroup" aria-label="Choose a grandchild" style={{
            marginTop: 26,
            display: "flex", flexWrap: "wrap", justifyContent: "center",
            gap: n <= 2 ? 56 : 36, rowGap: 24,
            maxWidth: 980,
          }}>
            {children.map((c, i) => {
              const selected = c.id === active?.id;
              const isHere = perryOnline && perryHereChildId === c.id;
              return (
                <div key={c.id} className="nm-home-kid" style={{
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
                  transform: selected && n > 1 ? "scale(1.04)" : "none",
                  opacity: selected || n === 1 ? 1 : 0.78,
                  animation: `nm-home-in 0.45s ${0.06 * i}s ease-out both`,
                }}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={c.name}
                    data-testid={`home-child-${c.name}`}
                    onClick={() => onSelectChild(c.id)}
                    style={{ position: "relative", padding: 0, border: "none", background: "transparent", cursor: "pointer", borderRadius: "50%", touchAction: "manipulation" }}
                  >
                    <ChildAvatar child={c} size={size} ring={selected ? "selected" : "plain"} />
                    {isHere && (
                      <span aria-label={`${c.name} is here`} style={{
                        position: "absolute", right: size * 0.08, bottom: size * 0.08,
                        width: Math.max(22, size * 0.13), height: Math.max(22, size * 0.13), borderRadius: "50%",
                        background: "#22c55e", border: "4px solid #0b172e",
                        animation: "nm-here-pulse 2s ease-in-out infinite",
                      }} />
                    )}
                  </button>
                  <span style={{ color: selected ? CREAM : "rgba(247,240,227,0.85)", fontFamily: SERIF, fontSize: n <= 2 ? 26 : 22, fontWeight: 700 }}>
                    {c.name}
                  </span>
                  {!c.photoUrl && (
                    <button
                      type="button"
                      onClick={() => void addPhoto(c)}
                      disabled={photoBusy === c.id}
                      data-testid={`home-add-photo-${c.name}`}
                      style={{
                        marginTop: -4, background: "transparent", border: "none",
                        color: AMBER, fontFamily: FONT, fontSize: 15, fontWeight: 700,
                        cursor: "pointer", padding: "6px 10px", minHeight: 36, touchAction: "manipulation",
                      }}
                    >
                      {photoBusy === c.id ? "Saving…" : "📷 Add photo"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Status line: who is here, or the next saved visit */}
          <div data-testid="home-status" style={{ marginTop: 22, minHeight: 34, display: "flex", alignItems: "center", gap: 10, fontFamily: FONT, fontSize: 18, fontWeight: 700 }}>
            {here ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 10, color: "#86efac" }}>
                <span aria-hidden style={{ width: 12, height: 12, borderRadius: "50%", background: "#22c55e", animation: "nm-here-pulse 2s ease-in-out infinite" }} />
                {name} is here
              </span>
            ) : otherHere ? (
              <span style={{ color: "rgba(247,240,227,0.75)" }}>{otherHere.name} is on the kids' iPad</span>
            ) : next ? (
              <span style={{ color: "rgba(247,240,227,0.85)" }}>📅 Next • {next}</span>
            ) : (
              <span style={{ color: "rgba(247,240,227,0.55)", fontWeight: 600 }}>Waiting for {name} to join</span>
            )}
          </div>

          <button type="button" data-testid="home-primary" className="nm-home-cta" onClick={onPrimary} style={{ ...ctaStyle(true), marginTop: 18 }}>
            {visitActive && continueBook ? (
              <>Back to <i style={{ fontFamily: SERIF, fontWeight: 700 }}>{continueBook.title}</i> with {name}</>
            ) : continueBook ? (
              <>Continue <i style={{ fontFamily: SERIF, fontWeight: 700 }}>{continueBook.title}</i> with {name}</>
            ) : (
              <>Start Reading with {name}</>
            )}
          </button>

          <button
            type="button"
            onClick={onAddChild}
            data-testid="home-add-child"
            style={{
              marginTop: 16, background: "transparent", border: "none",
              color: "rgba(247,240,227,0.7)", fontFamily: FONT, fontSize: 16, fontWeight: 700,
              cursor: "pointer", padding: "10px 14px", minHeight: 44, touchAction: "manipulation",
            }}
          >
            + Add a grandchild
          </button>
          {photoError && <div role="alert" style={{ color: "#fca5a5", fontFamily: FONT, fontSize: 15, marginTop: 6 }}>{photoError}</div>}
        </>
      )}

      <div style={{ flex: "1 1 0", minHeight: 8 }} />
    </div>
  );
}

function ctaStyle(enabled: boolean): CSSProperties {
  return {
    minHeight: 72, minWidth: "min(460px, 100%)", maxWidth: "100%",
    padding: "0 34px", borderRadius: 999, border: "none",
    background: enabled ? "linear-gradient(135deg, #f7c95d 0%, #C9922A 60%, #d97706 100%)" : "rgba(255,255,255,0.08)",
    color: enabled ? NAVY : "rgba(247,240,227,0.4)",
    fontFamily: FONT, fontSize: 22, fontWeight: 800, letterSpacing: "0.01em",
    boxShadow: enabled ? "0 12px 34px rgba(201,146,42,0.42), inset 0 1px 0 rgba(255,255,255,0.35)" : "none",
    cursor: enabled ? "pointer" : "not-allowed", touchAction: "manipulation",
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
    transition: "transform 120ms ease",
  };
}

/* ── Add a grandchild ─────────────────────────────────────────────── */

const fieldLabel: CSSProperties = {
  display: "block", color: "rgba(247,240,227,0.8)", fontFamily: FONT,
  fontSize: 14, fontWeight: 800, marginBottom: 6,
};
const fieldInput: CSSProperties = {
  width: "100%", boxSizing: "border-box",
  padding: "14px 16px", borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.18)", backgroundColor: "rgba(255,255,255,0.06)",
  color: CREAM, fontFamily: FONT, fontSize: 18, outline: "none",
};

/**
 * Add a grandchild (Build 38): name, a 4-digit PIN, an optional photo,
 * and the grown-up's permission. No birthday or age.
 */
export function AddChildModal({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: (body: { name: string; pin: string; consent: boolean; photo: string | null }) => Promise<unknown>;
}) {
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [consent, setConsent] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const valid = name.trim().length > 0 && /^\d{4}$/.test(pin) && consent;

  const choosePhoto = async () => {
    setError("");
    const f = await pickPhotoFile();
    if (!f) return;
    try { setPhoto(await compressPhoto(f)); } catch (e) { setError(e instanceof Error ? e.message : "Couldn't use that picture."); }
  };
  const submit = async () => {
    if (!valid || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await onConfirm({ name: name.trim(), pin, consent, photo });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add this grandchild. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="add-child-title" data-testid="add-child-modal"
      style={{ position: "absolute", inset: 0, zIndex: 90, backgroundColor: "rgba(8,15,30,0.8)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, animation: "phase-intro-fade 0.2s ease-out" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ backgroundColor: "#162240", border: "1px solid rgba(201,146,42,0.35)", borderRadius: 22, padding: "24px 24px 20px", width: "100%", maxWidth: 460, maxHeight: "100%", overflowY: "auto", boxShadow: "0 18px 60px rgba(0,0,0,0.55)", animation: "phase-card-up 0.28s cubic-bezier(0.22,1,0.36,1)" }}>
        <div id="add-child-title" style={{ color: CREAM, fontFamily: SERIF, fontSize: 28, fontWeight: 700, textAlign: "center" }}>Add a grandchild</div>
        <div style={{ color: "rgba(247,240,227,0.7)", fontFamily: FONT, fontSize: 15, lineHeight: 1.5, textAlign: "center", margin: "6px 0 18px" }}>
          They sign in on their iPad with a 4-digit PIN.
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
          <button type="button" onClick={() => void choosePhoto()} aria-label={photo ? "Change photo" : "Add a photo"} style={{ padding: 0, border: "none", background: "transparent", cursor: "pointer", borderRadius: "50%" }}>
            {photo
              ? <img src={photo} alt="" style={{ width: 84, height: 84, borderRadius: "50%", objectFit: "cover", border: `3px solid ${AMBER}` }} />
              : <span style={{ width: 84, height: 84, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", border: "2px dashed rgba(201,146,42,0.7)", color: AMBER, fontSize: 30 }}>📷</span>}
          </button>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <button type="button" onClick={() => void choosePhoto()} style={{ background: "transparent", border: "none", color: AMBER, fontFamily: FONT, fontSize: 17, fontWeight: 800, padding: 0, textAlign: "left", cursor: "pointer" }}>
              {photo ? "Change photo" : "Add a photo"}
            </button>
            <span style={{ color: "rgba(247,240,227,0.55)", fontFamily: FONT, fontSize: 13 }}>Optional. You can add it later.</span>
          </div>
        </div>

        <label style={fieldLabel} htmlFor="nm-add-child-name">Name</label>
        <input id="nm-add-child-name" type="text" value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder="Cooper" maxLength={40} style={{ ...fieldInput, marginBottom: 14 }} />

        <label style={fieldLabel} htmlFor="nm-add-child-pin">4-digit PIN</label>
        <input id="nm-add-child-pin" type="text" inputMode="numeric" pattern="\d{4}" value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
          placeholder="1234" style={{ ...fieldInput, fontSize: 22, letterSpacing: "0.4em", textAlign: "center", marginBottom: 14 }} />

        <label style={{ display: "flex", alignItems: "flex-start", gap: 12, cursor: "pointer", padding: "12px 14px", borderRadius: 14, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)" }}>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-testid="add-child-consent"
            style={{ width: 24, height: 24, marginTop: 2, accentColor: AMBER, flexShrink: 0 }} />
          <span style={{ color: CREAM, fontFamily: FONT, fontSize: 15, lineHeight: 1.45 }}>
            I'm their parent or guardian, or I have their parent's permission to set this up.
          </span>
        </label>

        {error && <div role="alert" style={{ color: "#fca5a5", fontFamily: FONT, fontSize: 14, marginTop: 10, textAlign: "center" }}>{error}</div>}

        <div style={{ display: "flex", gap: 12, marginTop: 18 }}>
          <button type="button" onClick={onClose} disabled={submitting} style={{ flex: 1, minHeight: 56, backgroundColor: "rgba(255,255,255,0.07)", color: CREAM, border: "1px solid rgba(255,255,255,0.18)", borderRadius: 999, fontFamily: FONT, fontWeight: 800, fontSize: 17, cursor: "pointer" }}>Cancel</button>
          <button type="button" onClick={() => void submit()} disabled={!valid || submitting} data-testid="add-child-submit"
            style={{ flex: 1, minHeight: 56, background: valid && !submitting ? "linear-gradient(135deg, #f7c95d 0%, #C9922A 55%, #d97706 100%)" : "rgba(255,255,255,0.08)", color: valid && !submitting ? NAVY : "rgba(247,240,227,0.4)", border: "none", borderRadius: 999, fontFamily: FONT, fontWeight: 800, fontSize: 17, cursor: valid && !submitting ? "pointer" : "not-allowed" }}>
            {submitting ? "Adding…" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Settings → Grandchildren ─────────────────────────────────────── */

export function GrandchildrenCard({
  children,
  onSetPhoto,
  onRemovePhoto,
  onUpdate,
  onAddChild,
}: {
  children: Child[];
  onSetPhoto: (childId: string, dataUrl: string) => Promise<void>;
  onRemovePhoto: (childId: string) => Promise<void>;
  onUpdate: (childId: string, body: { name?: string; pin?: string }) => Promise<void>;
  onAddChild: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [editing, setEditing] = useState<{ child: Child; field: "name" | "pin" } | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = window.setTimeout(() => setMsg(null), 5000);
    return () => window.clearTimeout(t);
  }, [msg]);

  const run = async (childId: string, fn: () => Promise<void>, ok: string) => {
    setBusy(childId);
    try { await fn(); setMsg({ text: ok }); }
    catch (e) { setMsg({ text: e instanceof Error ? e.message : "That didn't work. Try again.", bad: true }); }
    finally { setBusy(null); }
  };
  const changePhoto = async (c: Child) => {
    const f = await pickPhotoFile();
    if (!f) return;
    await run(c.id, async () => onSetPhoto(c.id, await compressPhoto(f)), `${c.name}'s photo is saved.`);
  };

  const smallBtn: CSSProperties = {
    minHeight: 44, padding: "0 14px", borderRadius: 999,
    background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.16)",
    color: CREAM, fontFamily: FONT, fontSize: 14, fontWeight: 700, cursor: "pointer", touchAction: "manipulation",
  };

  return (
    <div data-testid="settings-grandchildren" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
      {children.map(c => (
        <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 14px", borderRadius: 16, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", flexWrap: "wrap" }}>
          <ChildAvatar child={c} size={64} ring="plain" />
          <span style={{ color: CREAM, fontFamily: SERIF, fontSize: 22, fontWeight: 700, flex: "1 1 120px", minWidth: 0 }}>{c.name}</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" style={smallBtn} disabled={busy === c.id} onClick={() => void changePhoto(c)}>{c.photoUrl ? "Change photo" : "Add photo"}</button>
            {c.photoUrl && (
              <button type="button" style={smallBtn} disabled={busy === c.id} onClick={() => void run(c.id, () => onRemovePhoto(c.id), `${c.name}'s photo was removed.`)}>Remove photo</button>
            )}
            <button type="button" style={smallBtn} onClick={() => setEditing({ child: c, field: "name" })}>Rename</button>
            <button type="button" style={smallBtn} onClick={() => setEditing({ child: c, field: "pin" })}>Change PIN</button>
          </div>
        </div>
      ))}
      <button type="button" onClick={onAddChild} style={{ ...smallBtn, alignSelf: "flex-start", color: AMBER, borderColor: "rgba(201,146,42,0.5)" }}>+ Add a grandchild</button>
      {msg && <div role="status" style={{ color: msg.bad ? "#fca5a5" : "#86efac", fontFamily: FONT, fontSize: 15 }}>{msg.text}</div>}
      {editing && (
        <ChildEditModal
          child={editing.child}
          field={editing.field}
          onClose={() => setEditing(null)}
          onSave={async (value) => {
            const c = editing.child;
            await onUpdate(c.id, editing.field === "name" ? { name: value } : { pin: value });
            setMsg({ text: editing.field === "name" ? `Saved. Say hi to ${value}!` : `${c.name}'s new PIN is saved.` });
          }}
        />
      )}
    </div>
  );
}

function ChildEditModal({ child, field, onClose, onSave }: { child: Child; field: "name" | "pin"; onClose: () => void; onSave: (v: string) => Promise<void> }) {
  const [value, setValue] = useState(field === "name" ? child.name : "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const valid = field === "name" ? value.trim().length > 0 && value.trim().length <= 40 : /^\d{4}$/.test(value);
  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setError("");
    try { await onSave(field === "name" ? value.trim() : value); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't save. Try again."); }
    finally { setSaving(false); }
  };
  return (
    <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, zIndex: 95, backgroundColor: "rgba(8,15,30,0.8)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ backgroundColor: "#162240", border: "1px solid rgba(201,146,42,0.35)", borderRadius: 22, padding: 24, width: "100%", maxWidth: 420 }}>
        <div style={{ color: CREAM, fontFamily: SERIF, fontSize: 24, fontWeight: 700, marginBottom: 14, textAlign: "center" }}>
          {field === "name" ? `Rename ${child.name}` : `New PIN for ${child.name}`}
        </div>
        {field === "name" ? (
          <input type="text" value={value} autoFocus maxLength={40} onChange={(e) => setValue(e.target.value)} style={fieldInput} />
        ) : (
          <input type="text" inputMode="numeric" value={value} autoFocus placeholder="1234"
            onChange={(e) => setValue(e.target.value.replace(/\D/g, "").slice(0, 4))}
            style={{ ...fieldInput, fontSize: 24, letterSpacing: "0.4em", textAlign: "center" }} />
        )}
        {error && <div role="alert" style={{ color: "#fca5a5", fontFamily: FONT, fontSize: 14, marginTop: 10, textAlign: "center" }}>{error}</div>}
        <div style={{ display: "flex", gap: 12, marginTop: 18 }}>
          <button type="button" onClick={onClose} style={{ flex: 1, minHeight: 54, backgroundColor: "rgba(255,255,255,0.07)", color: CREAM, border: "1px solid rgba(255,255,255,0.18)", borderRadius: 999, fontFamily: FONT, fontWeight: 800, fontSize: 17, cursor: "pointer" }}>Cancel</button>
          <button type="button" onClick={() => void save()} disabled={!valid || saving}
            style={{ flex: 1, minHeight: 54, background: valid && !saving ? AMBER : "rgba(255,255,255,0.08)", color: valid && !saving ? NAVY : "rgba(247,240,227,0.4)", border: "none", borderRadius: 999, fontFamily: FONT, fontWeight: 800, fontSize: 17, cursor: valid ? "pointer" : "not-allowed" }}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
