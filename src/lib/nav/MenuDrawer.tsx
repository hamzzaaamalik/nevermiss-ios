import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, PhoneOff, X as XIcon } from "lucide-react";
import { useVideoSession } from "../video/VideoSessionProvider";
import { READING_THEMES, READING_THEME_LABEL, type ReadingTheme } from "../reading/themes";

const NAVY = "#1B2B4B";
const AMBER = "#C9922A";
const CREAM = "#F7F0E3";
const FONT = "DM Sans, sans-serif";

export type PointerMode = "finger" | "ruler" | "off";

export interface MenuPanel {
  title: string;
  /** `close` shuts the whole drawer (use after an action that navigates). */
  render: (close: () => void) => ReactNode;
}

export interface MenuItem {
  key: string;
  label: string;
  sublabel?: string;
  icon: ReactNode;
  onClick?: () => void;
  /** Opens an in-drawer panel ("‹ Menu" returns to the list). */
  panel?: MenuPanel;
  active?: boolean;
  destructive?: boolean;
  divider?: never;
}
export interface MenuDivider { divider: true; key: string; label?: string }
export type MenuEntry = MenuItem | MenuDivider;

/**
 * Close an open menu after `ms` without a touch inside it. Used on the
 * child's iPad (Rick's Build 33): a young child alone may not know how
 * to close a menu, and the dimmed backdrop stays up until someone does.
 */
export function useIdleAutoClose(open: boolean, onClose: () => void, ms: number | undefined, ref: React.RefObject<HTMLElement | null>) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open || !ms) return;
    let t = window.setTimeout(() => closeRef.current(), ms);
    const bump = (e: Event) => {
      if (!ref.current || !ref.current.contains(e.target as Node)) return;
      window.clearTimeout(t);
      t = window.setTimeout(() => closeRef.current(), ms);
    };
    document.addEventListener("pointerdown", bump, true);
    document.addEventListener("touchmove", bump, { capture: true, passive: true });
    document.addEventListener("scroll", bump, true);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("pointerdown", bump, true);
      document.removeEventListener("touchmove", bump, true);
      document.removeEventListener("scroll", bump, true);
    };
  }, [open, ms, ref]);
}

const headerBtn: React.CSSProperties = {
  minWidth: 44, height: 44, borderRadius: 999,
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.16)",
  color: CREAM,
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4,
  cursor: "pointer", padding: "0 12px",
  fontFamily: FONT, fontSize: 15, fontWeight: 700,
  touchAction: "manipulation",
};

/**
 * Right-side Menu drawer (Master Plan §4). Header is fixed: "← Back" moves
 * one screen backward (hidden when there's nowhere to go), "×" only
 * closes the drawer. Sub-panels open inside the drawer with "‹ Menu".
 * End Call is pinned to the bottom so Nana never scrolls to find it.
 */
export function MenuDrawer({
  open,
  onClose,
  entries,
  autoCloseMs,
  onBack,
  onEndCall,
}: {
  open: boolean;
  onClose: () => void;
  entries: MenuEntry[];
  autoCloseMs?: number;
  /** One meaningful screen back. Omit when there is nowhere to go. */
  onBack?: () => void;
  /** Pinned red End Call (Nana, while a visit is live). */
  onEndCall?: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Remember which panel is open, not a copy of it: the panel is drawn
  // from the current entries, so a choice lights up the moment it's
  // tapped (Rick's Build 36 #4) and live values like the page stay fresh.
  const [panelKey, setPanelKey] = useState<string | null>(null);
  const panel: MenuPanel | null = panelKey
    ? entries.find((en): en is MenuItem => !("divider" in en) && en.key === panelKey)?.panel ?? null
    : null;
  const setPanel = (p: { key: string } | null) => setPanelKey(p ? p.key : null);
  useIdleAutoClose(open, onClose, autoCloseMs, panelRef);
  useEffect(() => { if (!open) setPanelKey(null); }, [open]);
  if (!open) return null;
  return (
    <>
      <style>{`
        @keyframes nm-drawer-slide { from { transform: translateX(100%); opacity: 0.4; } to { transform: translateX(0); opacity: 1; } }
        .nm-menu-row:active { transform: scale(0.985); }
      `}</style>
      <div
        onClick={onClose}
        aria-hidden
        style={{
          position: "absolute", inset: 0, zIndex: 60,
          backgroundColor: "rgba(8,15,30,0.55)",
          backdropFilter: "blur(2px)",
          animation: "phase-intro-fade 0.2s ease-out",
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        data-testid="menu-drawer"
        style={{
          position: "absolute", top: 0, right: 0, bottom: 0,
          width: "min(380px, 90%)",
          zIndex: 70,
          background: "linear-gradient(180deg, #14223e 0%, #0b172e 100%)",
          borderLeft: "1px solid rgba(201,146,42,0.35)",
          boxShadow: "-8px 0 32px rgba(0,0,0,0.65)",
          display: "flex", flexDirection: "column",
          animation: "nm-drawer-slide 0.24s cubic-bezier(0.22,1,0.36,1)",
        }}
      >
        {/* Fixed header: ← Back · MENU · × */}
        <div style={{
          display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center",
          padding: "12px 12px 10px", gap: 8, flexShrink: 0,
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}>
          <div style={{ justifySelf: "start" }}>
            {panel ? (
              <button type="button" onClick={() => setPanel(null)} style={headerBtn} aria-label="Back to Menu">
                <ChevronLeft size={20} strokeWidth={2.4} aria-hidden /> Menu
              </button>
            ) : onBack ? (
              <button type="button" onClick={() => { onBack(); onClose(); }} style={headerBtn} aria-label="Go back one screen">
                <span aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>←</span> Back
              </button>
            ) : null}
          </div>
          <span style={{
            color: AMBER, fontFamily: FONT, fontSize: panel ? 15 : 13, fontWeight: 800,
            letterSpacing: panel ? "0.02em" : "0.16em", textTransform: panel ? "none" : "uppercase",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 170,
          }}>
            {panel ? panel.title : "Menu"}
          </span>
          <button type="button" onClick={onClose} aria-label="Close menu" style={{ ...headerBtn, justifySelf: "end", width: 44, padding: 0 }}>
            <XIcon size={20} strokeWidth={2.4} aria-hidden />
          </button>
        </div>

        {/* Scrolling list (or the open panel) */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "8px 12px 12px", WebkitOverflowScrolling: "touch" }}>
          {panel ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingTop: 6 }}>
              {panel.render(onClose)}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {entries.map((entry) => {
                if ("divider" in entry) {
                  return (
                    <div key={entry.key} style={{ margin: "12px 6px 4px" }}>
                      {entry.label && (
                        <span style={{ color: "rgba(201,146,42,0.85)", fontFamily: FONT, fontSize: 12, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase" }}>
                          {entry.label}
                        </span>
                      )}
                    </div>
                  );
                }
                return (
                  <MenuRow
                    key={entry.key}
                    entry={entry}
                    onActivate={() => {
                      if (entry.panel) { setPanel(entry); return; }
                      entry.onClick?.();
                      onClose();
                    }}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* Pinned End Call (Master Plan §4) */}
        {onEndCall && !panel && (
          <div style={{ flexShrink: 0, padding: "10px 12px 14px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
            <button
              type="button"
              data-testid="menu-end-call"
              onClick={() => { onEndCall(); onClose(); }}
              style={{
                width: "100%", minHeight: 64,
                display: "flex", alignItems: "center", gap: 14,
                padding: "10px 16px", borderRadius: 16,
                background: "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)",
                border: "none", color: "#fff",
                fontFamily: FONT, textAlign: "left", cursor: "pointer",
                boxShadow: "0 8px 22px rgba(239,68,68,0.35)",
                touchAction: "manipulation",
              }}
            >
              <span aria-hidden style={{
                width: 40, height: 40, borderRadius: 12, flexShrink: 0,
                background: "rgba(255,255,255,0.18)",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
              }}>
                <PhoneOff size={20} strokeWidth={2.4} />
              </span>
              <span style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 18, fontWeight: 800 }}>End Call</span>
                <span style={{ fontSize: 13, fontWeight: 600, opacity: 0.9 }}>End the call now.</span>
              </span>
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function MenuRow({ entry, onActivate }: { entry: MenuItem; onActivate: () => void }) {
  return (
    <button
      type="button"
      className="nm-menu-row"
      data-menu-key={entry.key}
      onClick={onActivate}
      style={{
        display: "flex", alignItems: "center", gap: 14,
        padding: "10px 12px", minHeight: 58,
        borderRadius: 14,
        backgroundColor: entry.active ? "rgba(201,146,42,0.14)" : "transparent",
        border: `1px solid ${entry.active ? "rgba(201,146,42,0.45)" : "transparent"}`,
        color: entry.destructive ? "#f87171" : (entry.active ? AMBER : CREAM),
        fontFamily: FONT, textAlign: "left", cursor: "pointer",
        touchAction: "manipulation",
        transition: "background-color 140ms ease, transform 100ms ease",
      }}
    >
      <span aria-hidden style={{
        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
        backgroundColor: entry.active ? "rgba(201,146,42,0.2)" : "rgba(255,255,255,0.07)",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
      }}>
        {entry.icon}
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
        <span style={{ fontSize: 17, fontWeight: 700 }}>{entry.label}</span>
        {entry.sublabel && (
          <span style={{ fontSize: 13, fontWeight: 500, opacity: 0.65, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{entry.sublabel}</span>
        )}
      </span>
      {entry.panel && <ChevronRight size={20} strokeWidth={2.2} aria-hidden style={{ opacity: 0.6, flexShrink: 0 }} />}
    </button>
  );
}

/* ── Panel building blocks ─────────────────────────────────────────── */

export function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ color: "rgba(247,240,227,0.7)", fontFamily: FONT, fontSize: 14, fontWeight: 800 }}>{title}</span>
      {children}
    </div>
  );
}

/** Big segmented control: one tap picks, the choice is obvious. */
export function Segmented<T extends string | number>({
  value, options, onChange, testId,
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode; sub?: string }>;
  onChange: (v: T) => void;
  testId?: string;
}) {
  return (
    <div role="radiogroup" data-testid={testId} style={{ display: "flex", gap: 6, background: "rgba(255,255,255,0.05)", padding: 4, borderRadius: 14, border: "1px solid rgba(255,255,255,0.1)" }}>
      {options.map(o => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            style={{
              flex: 1, minHeight: 50, borderRadius: 11, border: "none",
              background: on ? AMBER : "transparent",
              color: on ? NAVY : CREAM,
              fontFamily: FONT, fontSize: 15, fontWeight: 800,
              cursor: "pointer", touchAction: "manipulation",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1,
              transition: "background-color 140ms ease",
            }}
          >
            <span>{o.label}</span>
            {o.sub && <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.75 }}>{o.sub}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Full-width switch row (mic, camera, help tips). */
export function ToggleRow({ label, sub, on, onChange, icon, disabled, testId }: {
  label: string; sub?: string; on: boolean; onChange: (v: boolean) => void; icon?: ReactNode; disabled?: boolean; testId?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      data-testid={testId}
      disabled={disabled}
      onClick={() => onChange(!on)}
      style={{
        display: "flex", alignItems: "center", gap: 12, width: "100%",
        minHeight: 60, padding: "10px 14px", borderRadius: 14,
        background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
        color: CREAM, fontFamily: FONT, textAlign: "left",
        cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1,
        touchAction: "manipulation",
      }}
    >
      {icon && <span aria-hidden style={{ display: "inline-flex", width: 28, justifyContent: "center" }}>{icon}</span>}
      <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 17, fontWeight: 700 }}>{label}</span>
        {sub && <span style={{ fontSize: 13, opacity: 0.65 }}>{sub}</span>}
      </span>
      <span aria-hidden style={{
        width: 54, height: 32, borderRadius: 999, flexShrink: 0, position: "relative",
        background: on ? "#22c55e" : "rgba(255,255,255,0.18)",
        transition: "background-color 160ms ease",
      }}>
        <span style={{
          position: "absolute", top: 3, left: on ? 25 : 3, width: 26, height: 26, borderRadius: "50%",
          background: "#fff", boxShadow: "0 2px 6px rgba(0,0,0,0.35)", transition: "left 160ms ease",
        }} />
      </span>
    </button>
  );
}

/** Plain action row inside a panel. */
export function PanelAction({ label, sub, icon, onClick, active, testId }: {
  label: string; sub?: string; icon?: ReactNode; onClick: () => void; active?: boolean; testId?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 12, width: "100%",
        minHeight: 56, padding: "10px 14px", borderRadius: 14,
        background: active ? "rgba(201,146,42,0.16)" : "rgba(255,255,255,0.05)",
        border: `1px solid ${active ? "rgba(201,146,42,0.55)" : "rgba(255,255,255,0.1)"}`,
        color: active ? AMBER : CREAM, fontFamily: FONT, textAlign: "left",
        cursor: "pointer", touchAction: "manipulation",
      }}
    >
      {icon && <span aria-hidden style={{ display: "inline-flex", width: 28, justifyContent: "center", flexShrink: 0 }}>{icon}</span>}
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 16, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
        {sub && <span style={{ fontSize: 13, opacity: 0.65 }}>{sub}</span>}
      </span>
    </button>
  );
}

/* ── The panels ────────────────────────────────────────────────────── */

export function ReadingSetupPanel({
  pageMode, onPageModeChange,
  fontScale, onFontScaleChange,
  theme, onThemeChange,
  pointerMode, onPointerModeChange,
}: {
  pageMode: "single" | "double"; onPageModeChange?: (m: "single" | "double") => void;
  fontScale: number; onFontScaleChange?: (s: number) => void;
  theme: ReadingTheme; onThemeChange?: (t: ReadingTheme) => void;
  pointerMode: PointerMode; onPointerModeChange?: (m: PointerMode) => void;
}) {
  const sizeKey = fontScale >= 1.5 ? 1.5 : fontScale >= 1.25 ? 1.25 : fontScale >= 1 ? 1 : 0.85;
  return (
    <>
      {onPageModeChange && (
        <PanelSection title="Pages">
          <Segmented
            testId="setup-pages"
            value={pageMode}
            onChange={onPageModeChange}
            options={[{ value: "single", label: "One page" }, { value: "double", label: "Two pages" }]}
          />
        </PanelSection>
      )}
      {onFontScaleChange && (
        <PanelSection title="Text size (both iPads)">
          <Segmented
            testId="setup-size"
            value={sizeKey}
            onChange={onFontScaleChange}
            options={[
              { value: 0.85, label: <span style={{ fontSize: 14 }}>A</span>, sub: "Small" },
              { value: 1, label: <span style={{ fontSize: 17 }}>A</span>, sub: "Medium" },
              { value: 1.25, label: <span style={{ fontSize: 20 }}>A</span>, sub: "Large" },
              { value: 1.5, label: <span style={{ fontSize: 23 }}>A</span>, sub: "Extra" },
            ]}
          />
        </PanelSection>
      )}
      {onThemeChange && (
        <PanelSection title="Light / Dark">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }} role="radiogroup" data-testid="setup-theme">
            {(["day", "bright", "sepia", "night"] as ReadingTheme[]).map(t => {
              const on = t === theme;
              const c = READING_THEMES[t];
              return (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => onThemeChange(t)}
                  style={{
                    minHeight: 64, borderRadius: 12,
                    background: c.page, color: c.text,
                    border: on ? `3px solid ${AMBER}` : "1px solid rgba(255,255,255,0.25)",
                    fontFamily: FONT, fontSize: 13, fontWeight: 800,
                    cursor: "pointer", touchAction: "manipulation",
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2,
                  }}
                >
                  <span style={{ fontFamily: "Playfair Display, serif", fontSize: 18 }}>Aa</span>
                  {READING_THEME_LABEL[t]}
                </button>
              );
            })}
          </div>
        </PanelSection>
      )}
      {onPointerModeChange && (
        <PanelSection title="Reading pointer">
          <Segmented
            testId="setup-pointer"
            value={pointerMode}
            onChange={onPointerModeChange}
            options={[
              { value: "finger", label: "👆 Finger" },
              { value: "ruler", label: "▬ Line" },
              { value: "off", label: "Off" },
            ]}
          />
          <span style={{ color: "rgba(247,240,227,0.6)", fontFamily: FONT, fontSize: 13, lineHeight: 1.4 }}>
            Slide your finger slowly along the words; the child sees it move. A quick flick still turns the page.
          </span>
        </PanelSection>
      )}
    </>
  );
}

export function CameraMicPanel() {
  const { isMicEnabled, isCameraEnabled, setMicEnabled, setCameraEnabled, status, canFlipCamera, flipCamera, isCameraFlipped } = useVideoSession();
  const live = status !== "idle" && status !== "error";
  return (
    <>
      <ToggleRow testId="cam-mic" label="Microphone" sub={isMicEnabled ? "They can hear you" : "Muted"} on={isMicEnabled} onChange={setMicEnabled} disabled={!live} icon={<span style={{ fontSize: 20 }}>🎤</span>} />
      <ToggleRow testId="cam-cam" label="Camera" sub={isCameraEnabled ? "They can see you" : "Camera off"} on={isCameraEnabled} onChange={setCameraEnabled} disabled={!live} icon={<span style={{ fontSize: 20 }}>📷</span>} />
      {canFlipCamera && (
        <PanelAction
          testId="cam-flip"
          label={isCameraFlipped ? "Switch back to the front camera" : "Flip camera"}
          sub={isCameraFlipped ? "Showing the back camera" : "Use the back camera to show something"}
          icon={<span style={{ fontSize: 20 }}>🔄</span>}
          onClick={flipCamera}
        />
      )}
      {!live && (
        <span style={{ color: "rgba(247,240,227,0.6)", fontFamily: FONT, fontSize: 14 }}>
          Video isn't connected right now.
        </span>
      )}
    </>
  );
}

/** Help tips on/off, shared with the old corner "Need help?" pill. */
export function readHelpTipsOn(): boolean {
  try { return localStorage.getItem("nevermiss_phase_cards") !== "off"; } catch { return true; }
}
export function setHelpTipsOn(val: boolean) {
  try { localStorage.setItem("nevermiss_phase_cards", val ? "on" : "off"); } catch {}
  window.dispatchEvent(new StorageEvent("storage", { key: "nevermiss_phase_cards", newValue: val ? "on" : "off" }));
  if (val) window.dispatchEvent(new CustomEvent("nm:help-reactivated"));
}

export function HelpFeedbackPanel({ onSendFeedback, close }: { onSendFeedback?: () => void; close: () => void }) {
  const [tips, setTips] = useState(readHelpTipsOn);
  return (
    <>
      {onSendFeedback && (
        <PanelAction
          testId="help-feedback"
          label="Send Feedback"
          sub="Tell us what's working and what isn't"
          icon={<span style={{ fontSize: 20 }}>✉️</span>}
          onClick={() => { close(); onSendFeedback(); }}
        />
      )}
      <ToggleRow
        testId="help-tips"
        label="Help tips"
        sub={tips ? "Short tips appear on each new screen" : "Tips are hidden"}
        on={tips}
        onChange={(v) => { setTips(v); setHelpTipsOn(v); }}
        icon={<span style={{ fontSize: 20 }}>💡</span>}
      />
    </>
  );
}

export function ChaptersPanel({
  chapters, currentIndex, pageNum, pageTotal, onJump, close,
}: {
  chapters: Array<{ title: string; page: number }>;
  currentIndex: number;
  pageNum: number;
  pageTotal: number;
  onJump: (page: number) => void;
  close: () => void;
}) {
  return (
    <>
      <div style={{ color: CREAM, fontFamily: FONT, fontSize: 16, fontWeight: 700, padding: "0 4px" }}>
        Page {pageNum} of {pageTotal}
      </div>
      {chapters.length > 1 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }} data-testid="chapter-list">
          {chapters.map((c, i) => (
            <PanelAction
              key={`${c.page}-${i}`}
              label={c.title}
              sub={i === currentIndex ? "You are here" : undefined}
              active={i === currentIndex}
              icon={<span style={{ fontFamily: FONT, fontSize: 14, fontWeight: 800, opacity: 0.8 }}>{i + 1}</span>}
              onClick={() => { onJump(c.page); close(); }}
            />
          ))}
        </div>
      ) : (
        <PanelAction
          label="Back to the beginning"
          icon={<span style={{ fontSize: 18 }}>⏮</span>}
          onClick={() => { onJump(1); close(); }}
        />
      )}
    </>
  );
}

/** "End this call?" confirm (Master Plan §4): Cancel / End Call. */
export function EndCallConfirm({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="end-call-title"
      data-testid="end-call-confirm"
      style={{
        position: "absolute", inset: 0, zIndex: 80,
        backgroundColor: "rgba(8,15,30,0.78)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20,
        animation: "phase-intro-fade 0.2s ease-out",
      }}
    >
      <div style={{
        backgroundColor: "#162240",
        border: "1px solid rgba(248,113,113,0.45)",
        borderRadius: 22,
        padding: "26px 24px 22px",
        width: "100%", maxWidth: 420,
        textAlign: "center",
        boxShadow: "0 18px 60px rgba(0,0,0,0.55)",
        animation: "phase-card-up 0.28s cubic-bezier(0.22,1,0.36,1)",
      }}>
        <div id="end-call-title" style={{ color: CREAM, fontFamily: "Playfair Display, serif", fontSize: 28, fontWeight: 700 }}>
          End this call?
        </div>
        <div style={{ color: "rgba(247,240,227,0.78)", fontFamily: FONT, fontSize: 17, lineHeight: 1.5, marginTop: 8, marginBottom: 22 }}>
          The video call ends on both iPads. Your place in the book is saved.
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              flex: 1, minHeight: 58, backgroundColor: "rgba(255,255,255,0.07)", color: CREAM,
              border: "1px solid rgba(255,255,255,0.2)", borderRadius: 999,
              fontFamily: FONT, fontWeight: 800, fontSize: 18, cursor: "pointer", touchAction: "manipulation",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            style={{
              flex: 1, minHeight: 58, backgroundColor: "#ef4444", color: "white",
              border: "none", borderRadius: 999,
              fontFamily: FONT, fontWeight: 800, fontSize: 18, cursor: "pointer", touchAction: "manipulation",
              boxShadow: "0 6px 22px rgba(239,68,68,0.35)",
            }}
          >
            End Call
          </button>
        </div>
      </div>
    </div>
  );
}
