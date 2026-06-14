import { useEffect, useRef, useState } from "react";
import { Wifi, WifiOff } from "lucide-react";
import { useVideoSession } from "./VideoSessionProvider";

const RECONNECT_GRACE_MS = 600;
const RECONNECTED_FLASH_MS = 1800;

type BannerState = "hidden" | "warn" | "error" | "ok";

/**
 * Top-of-screen banner that surfaces transient connection problems without
 * stealing focus from the reading flow.
 *
 *   hidden  — fully connected and never been degraded
 *   warn    — reconnecting / audio-only / connecting (>grace)
 *   error   — fatal connection error
 *   ok      — brief "Reconnected" pulse after a degraded period; auto-hides
 */
export function ReconnectBanner() {
  const { status } = useVideoSession();
  const [state, setState] = useState<BannerState>("hidden");
  const wasDegraded = useRef(false);

  useEffect(() => {
    let cleanup: (() => void) | undefined;

    if (status === "connected") {
      if (wasDegraded.current) {
        wasDegraded.current = false;
        setState("ok");
        const t = setTimeout(() => setState("hidden"), RECONNECTED_FLASH_MS);
        cleanup = () => clearTimeout(t);
      } else {
        setState("hidden");
      }
    } else if (status === "error") {
      wasDegraded.current = true;
      setState("error");
    } else if (status === "reconnecting" || status === "audio-only") {
      wasDegraded.current = true;
      setState("warn");
    } else if (status === "connecting") {
      // Grace period — don't flash a banner for a sub-second blip.
      const t = setTimeout(() => {
        wasDegraded.current = true;
        setState("warn");
      }, RECONNECT_GRACE_MS);
      cleanup = () => clearTimeout(t);
    } else {
      setState("hidden");
    }

    return cleanup;
  }, [status]);

  if (state === "hidden") return null;

  const config = {
    warn: {
      bg: "rgba(234,179,8,0.16)",
      border: "rgba(234,179,8,0.55)",
      tone: "#eab308",
      Icon: WifiOff,
      title: status === "audio-only" ? "Audio only" : "Reconnecting…",
      sub: status === "audio-only"
        ? "Video temporarily unavailable. Reading isn't affected."
        : "Trying to restore the connection.",
    },
    error: {
      bg: "rgba(239,68,68,0.18)",
      border: "rgba(239,68,68,0.6)",
      tone: "#ef4444",
      Icon: WifiOff,
      title: "Connection lost",
      sub: "Retrying — reading and pages still work.",
    },
    ok: {
      bg: "rgba(34,197,94,0.16)",
      border: "rgba(34,197,94,0.55)",
      tone: "#22c55e",
      Icon: Wifi,
      title: "Reconnected",
      sub: "You're back live.",
    },
  }[state];

  const { Icon } = config;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        top: 12,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 14px",
        borderRadius: 999,
        backgroundColor: config.bg,
        border: `1px solid ${config.border}`,
        backdropFilter: "blur(10px)",
        boxShadow: "0 6px 24px rgba(0,0,0,0.35)",
        color: "#fff",
        fontFamily: "Inter, DM Sans, sans-serif",
        fontSize: 12,
        maxWidth: "92vw",
        pointerEvents: "none",
        animation: "reconnect-banner-in 280ms cubic-bezier(0.2,0.7,0.2,1)",
      }}
    >
      <span
        style={{
          width: 22,
          height: 22,
          borderRadius: "50%",
          backgroundColor: `color-mix(in srgb, ${config.tone} 22%, transparent)`,
          color: config.tone,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon size={13} aria-hidden />
      </span>
      <span style={{ fontWeight: 700 }}>{config.title}</span>
      <span style={{ opacity: 0.75 }}>{config.sub}</span>
    </div>
  );
}
