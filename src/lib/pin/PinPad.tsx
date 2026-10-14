import { useEffect, useRef, useState } from "react";

const AMBER = "#C9922A";
const CREAM = "#F7F0E3";
const FONT = "DM Sans, sans-serif";

/**
 * A big on-screen PIN pad (Rick's Build 40 review: the iPad keyboard
 * covered the PIN screen and the Join button). No keyboard opens for a
 * PIN anywhere in the app; a hardware keyboard still works.
 *
 * `onComplete` fires once all digits are in, so a child taps four numbers
 * and is done.
 */
export function PinPad({
  value,
  onChange,
  onComplete,
  length = 4,
  disabled = false,
  error = false,
  keySize = 72,
  label,
  testId = "pin-pad",
}: {
  value: string;
  onChange: (next: string) => void;
  onComplete?: (pin: string) => void;
  length?: number;
  disabled?: boolean;
  /** A wrong PIN: the dots shake. */
  error?: boolean;
  keySize?: number;
  label?: string;
  testId?: string;
}) {
  const [shakeKey, setShakeKey] = useState(0);
  useEffect(() => { if (error) setShakeKey(k => k + 1); }, [error]);
  // The latest value for the hardware-keyboard listener.
  const valueRef = useRef(value);
  valueRef.current = value;

  const press = (d: string) => {
    if (disabled) return;
    const cur = valueRef.current;
    if (cur.length >= length) return;
    const next = cur + d;
    valueRef.current = next;
    onChange(next);
    if (next.length === length) onComplete?.(next);
  };
  const back = () => {
    if (disabled) return;
    const next = valueRef.current.slice(0, -1);
    valueRef.current = next;
    onChange(next);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); press(e.key); }
      else if (e.key === "Backspace") { e.preventDefault(); back(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const gap = Math.round(keySize * 0.2);
  const keyStyle = {
    width: keySize, height: keySize, borderRadius: "50%",
    border: "1.5px solid rgba(247,201,93,0.45)",
    background: "rgba(255,255,255,0.07)",
    color: CREAM, fontFamily: FONT, fontSize: Math.round(keySize * 0.42), fontWeight: 700,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.4 : 1,
    display: "flex", alignItems: "center", justifyContent: "center",
    touchAction: "manipulation" as const,
    WebkitTapHighlightColor: "transparent",
    userSelect: "none" as const,
  };
  return (
    <div data-testid={testId} data-disabled={disabled ? "true" : "false"} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: Math.round(keySize * 0.28) }}>
      <style>{`
        @keyframes nm-pin-shake { 0%,100% { transform: translateX(0); } 20%,60% { transform: translateX(-10px); } 40%,80% { transform: translateX(10px); } }
        .nm-pin-key:active { background: rgba(247,201,93,0.28) !important; transform: scale(0.96); }
      `}</style>
      {label && (
        <div style={{ color: "rgba(247,240,227,0.85)", fontFamily: FONT, fontSize: 17, fontWeight: 700, textAlign: "center" }}>{label}</div>
      )}
      <div
        key={shakeKey}
        aria-label={`${value.length} of ${length} digits entered`}
        data-testid={`${testId}-dots`}
        style={{ display: "flex", gap: 16, animation: shakeKey ? "nm-pin-shake 0.42s ease-in-out" : undefined }}
      >
        {Array.from({ length }, (_, i) => (
          <span key={i} data-filled={i < value.length ? "true" : "false"} style={{
            width: 20, height: 20, borderRadius: "50%",
            background: i < value.length ? (error ? "#f87171" : AMBER) : "transparent",
            border: `2px solid ${error ? "#f87171" : "rgba(247,201,93,0.75)"}`,
            transition: "background 120ms ease",
          }} />
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(3, ${keySize}px)`, gap }}>
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map(d => (
          <button key={d} type="button" className="nm-pin-key" data-pin-key={d} disabled={disabled} onClick={() => press(d)} style={keyStyle}>{d}</button>
        ))}
        <span aria-hidden />
        <button type="button" className="nm-pin-key" data-pin-key="0" disabled={disabled} onClick={() => press("0")} style={keyStyle}>0</button>
        <button
          type="button"
          className="nm-pin-key"
          data-pin-key="back"
          aria-label="Delete the last digit"
          disabled={disabled || value.length === 0}
          onClick={back}
          style={{ ...keyStyle, border: "none", background: "transparent", fontSize: Math.round(keySize * 0.36), opacity: disabled || value.length === 0 ? 0.35 : 0.9 }}
        >
          ⌫
        </button>
      </div>
    </div>
  );
}
