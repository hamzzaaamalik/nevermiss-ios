import { useEffect, useState } from "react";

const TEXT_TYPES = new Set(["text", "email", "password", "search", "tel", "url", "number", ""]);

function isTextEntry(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return TEXT_TYPES.has((el.type || "").toLowerCase());
  return (el as HTMLElement).isContentEditable === true;
}

/** The text fields of a form, in order, that can take the keyboard. */
function scopeFields(scope: Element): HTMLInputElement[] {
  return Array.from(scope.querySelectorAll<HTMLInputElement>("input"))
    .filter(i => isTextEntry(i) && !i.disabled && i.offsetParent !== null);
}

/** The nearest ancestor that scrolls (and has room to). */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight + 1) return p;
  }
  return null;
}

/**
 * Scrolls the field, then its form's button, into the part of the screen
 * the keyboard leaves free. The browser's own scrollIntoView doesn't know
 * the keyboard covers the bottom of the screen, so this measures it.
 */
function revealAboveKeyboard(field: HTMLElement, submit: HTMLElement | null, inset: number) {
  const parent = scrollParent(field);
  if (!parent) return;
  const top = 12;
  const bottom = window.innerHeight - inset - 12;
  const f = field.getBoundingClientRect();
  let delta = 0;
  if (f.bottom > bottom) delta = f.bottom - bottom;
  else if (f.top < top) delta = f.top - top;
  if (submit) {
    const b = submit.getBoundingClientRect();
    const need = b.bottom - delta - bottom;
    // The button too, as long as the field stays on screen.
    if (need > 0) delta += Math.max(0, Math.min(need, f.top - delta - top));
  }
  if (Math.abs(delta) >= 1) parent.scrollTop += delta;
}

const STYLE_ID = "nm-keyboard-style";
const STYLE = `
  html[data-nm-keyboard="open"] .nm-kb-pad { padding-bottom: calc(var(--nm-kb, 0px) + 20px) !important; }
  html[data-nm-keyboard="open"] .nm-kb-lift { padding-bottom: calc(var(--nm-kb, 0px) + 12px) !important; }
`;

/**
 * The iPad keyboard (Rick's Build 40 review: it covered Next / Join and
 * there was no obvious way to close it). While it is open:
 *  - <html> gets data-nm-keyboard="open" and --nm-kb (its height), so
 *    screens marked .nm-kb-pad / .nm-kb-lift make room above it;
 *  - the field being typed in, and its form's button, scroll into the
 *    part of the screen the keyboard doesn't cover;
 *  - Return moves to the next field of a [data-kb-scope] form, then
 *    presses its [data-kb-submit] button;
 *  - tapping empty space closes it (a button keeps its own meaning, so a
 *    tap on Log In is never lost), and a Done button sits above it.
 * PINs never use the keyboard: they have their own pad.
 */
export function useKeyboardAssist(): { open: boolean } {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!document.getElementById(STYLE_ID)) {
      const st = document.createElement("style");
      st.id = STYLE_ID;
      st.textContent = STYLE;
      document.head.appendChild(st);
    }
    const root = document.documentElement;
    // Automated tests have no on-screen keyboard: "nm:kb-sim" with a
    // height stands in for one.
    let simulated = 0;
    let lastInset = 0;
    const measure = () => {
      const vv = window.visualViewport;
      const real = vv ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;
      const inset = simulated || real;
      const isOpen = inset > 120 && isTextEntry(document.activeElement);
      lastInset = isOpen ? inset : 0;
      if (isOpen) {
        root.style.setProperty("--nm-kb", `${inset}px`);
        root.setAttribute("data-nm-keyboard", "open");
      } else {
        root.removeAttribute("data-nm-keyboard");
        root.style.removeProperty("--nm-kb");
      }
      setOpen(isOpen);
      return isOpen;
    };
    let revealTimer: number | null = null;
    const revealFocused = () => {
      if (revealTimer !== null) window.clearTimeout(revealTimer);
      // After the keyboard has slid up.
      revealTimer = window.setTimeout(() => {
        revealTimer = null;
        if (!measure()) return;
        const el = document.activeElement as HTMLElement | null;
        if (!el || !isTextEntry(el)) return;
        const submit = el.closest("[data-kb-scope]")?.querySelector<HTMLElement>("[data-kb-submit]") ?? null;
        revealAboveKeyboard(el, submit, lastInset);
      }, 320);
    };
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target as HTMLElement;
      if (!isTextEntry(el)) return;
      const scope = el.closest("[data-kb-scope]");
      // The Return key says what it will do: Next, then Go (or Done).
      if (scope && el instanceof HTMLInputElement && !el.hasAttribute("enterkeyhint")) {
        const fields = scopeFields(scope);
        const last = fields.indexOf(el) === fields.length - 1;
        el.setAttribute("enterkeyhint", last ? (scope.querySelector("[data-kb-submit]") ? "go" : "done") : "next");
      }
      revealFocused();
    };
    const onFocusOut = () => { window.setTimeout(measure, 60); };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.defaultPrevented || e.isComposing) return;
      const el = e.target as HTMLElement;
      if (!(el instanceof HTMLInputElement) || !isTextEntry(el)) return;
      const scope = el.closest("[data-kb-scope]");
      if (!scope) return;
      e.preventDefault();
      const fields = scopeFields(scope);
      const next = fields[fields.indexOf(el) + 1];
      if (next) { next.focus(); return; }
      const submit = scope.querySelector<HTMLButtonElement>("[data-kb-submit]");
      el.blur();
      if (submit && !submit.disabled) submit.click();
    };
    const onPointerDown = (e: PointerEvent) => {
      const active = document.activeElement as HTMLElement | null;
      if (!isTextEntry(active)) return;
      const t = e.target as HTMLElement | null;
      if (!t || t.closest("input, textarea, select, button, a, label, [role=button], [contenteditable=true]")) return;
      active.blur();
    };
    const onSim = (e: Event) => {
      simulated = Number((e as CustomEvent).detail) || 0;
      if (simulated) revealFocused(); else measure();
    };
    const vv = window.visualViewport;
    vv?.addEventListener("resize", measure);
    vv?.addEventListener("scroll", measure);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("nm:kb-sim", onSim);
    return () => {
      if (revealTimer !== null) window.clearTimeout(revealTimer);
      vv?.removeEventListener("resize", measure);
      vv?.removeEventListener("scroll", measure);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("nm:kb-sim", onSim);
    };
  }, []);
  return { open };
}

/** A Done button just above the keyboard that closes it. */
export function KeyboardDoneButton({ open }: { open: boolean }) {
  if (!open) return null;
  return (
    <button
      type="button"
      data-testid="kb-done"
      // Keep the field focused until the tap lands, so nothing shifts first.
      onPointerDown={(e) => e.preventDefault()}
      onClick={() => (document.activeElement as HTMLElement | null)?.blur()}
      style={{
        position: "fixed", right: 16, bottom: "calc(var(--nm-kb, 0px) + 12px)", zIndex: 10050,
        minHeight: 48, padding: "0 22px", borderRadius: 999,
        border: "1.5px solid rgba(247,201,93,0.8)",
        background: "#162240", color: "#F7F0E3",
        fontFamily: "DM Sans, sans-serif", fontSize: 17, fontWeight: 800,
        boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
        cursor: "pointer", touchAction: "manipulation",
      }}
    >
      Done
    </button>
  );
}
