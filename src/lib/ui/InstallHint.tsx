import type { ReactElement, ReactNode } from "react";
import { useEffect, useState } from "react";
import { Maximize2, Share, Smartphone, X } from "lucide-react";
import { COLOR, FONT, RADIUS, SHADOW, SPACE } from "./tokens";

type Platform = "ios" | "android" | "desktop";

const STORAGE_KEY = "nm_install_hint_dismissed";

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent.toLowerCase();
  // iPadOS 13+ identifies as Mac with touch — UA-only sniff misses it.
  const isIpad = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  if (/iphone|ipad|ipod/.test(ua) || isIpad) return "ios";
  if (/android/.test(ua)) return "android";
  return "desktop";
}

/** True when the page is running as an installed standalone web app (not in browser chrome). */
function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // iOS Safari special case
  const nav = window.navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return true;
  // Other browsers
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    window.matchMedia?.("(display-mode: fullscreen)").matches === true
  );
}

function isFullscreenApiSupported(): boolean {
  if (typeof document === "undefined") return false;
  return Boolean(
    document.fullscreenEnabled ||
      // Safari prefix
      (document as Document & { webkitFullscreenEnabled?: boolean }).webkitFullscreenEnabled
  );
}

async function requestFullscreenSafe(): Promise<boolean> {
  try {
    const el = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>;
    };
    if (el.requestFullscreen) {
      await el.requestFullscreen();
      return true;
    }
    if (el.webkitRequestFullscreen) {
      await el.webkitRequestFullscreen();
      return true;
    }
  } catch {
    // User declined or browser blocked.
  }
  return false;
}

interface InstallHintProps {
  /** Optional override for testing the banner regardless of detection. */
  forceShow?: boolean;
}

/**
 * Small dismissible banner that surfaces the right install / fullscreen
 * pathway for each platform.
 *
 * - iOS Safari (not yet a PWA): "Tap Share → Add to Home Screen for full-screen"
 * - Android Chrome (not yet a PWA): platform install prompt OR Add to Home Screen
 * - Desktop: a "Go fullscreen" button using the native Fullscreen API
 *
 * Hidden when already running standalone (PWA installed) or when previously
 * dismissed by the user.
 */
export function InstallHint({ forceShow = false }: InstallHintProps) {
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === "yes"; } catch { return false; }
  });
  const [platform, setPlatform] = useState<Platform>("desktop");
  const [standalone, setStandalone] = useState(false);
  const [fullscreenSupported, setFullscreenSupported] = useState(false);

  useEffect(() => {
    setPlatform(detectPlatform());
    setStandalone(isStandalone());
    setFullscreenSupported(isFullscreenApiSupported());

    const onChange = () => setStandalone(isStandalone());
    const mql = window.matchMedia?.("(display-mode: standalone)");
    mql?.addEventListener?.("change", onChange);
    return () => mql?.removeEventListener?.("change", onChange);
  }, []);

  if (!forceShow) {
    if (dismissed) return null;
    if (standalone) return null;
  }

  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(STORAGE_KEY, "yes"); } catch {}
  };

  const goFullscreen = async () => {
    const ok = await requestFullscreenSafe();
    if (ok) dismiss();
  };

  const config = pickContent(platform, fullscreenSupported);

  return (
    <div
      role="region"
      aria-label="Get the best NeverMiss experience"
      style={{
        position: "fixed",
        top: SPACE.md,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1000,
        maxWidth: "min(94vw, 460px)",
        width: "calc(100% - 24px)",
        backgroundColor: "rgba(11,23,46,0.94)",
        backdropFilter: "blur(12px)",
        border: `1px solid ${COLOR.border}`,
        borderRadius: RADIUS.lg,
        padding: `${SPACE.md}px ${SPACE.md}px ${SPACE.md}px ${SPACE.lg}px`,
        boxShadow: SHADOW.lg,
        display: "flex",
        alignItems: "center",
        gap: SPACE.md,
        color: COLOR.text,
        fontFamily: FONT.sans,
        animation: "reconnect-banner-in 280ms cubic-bezier(0.2,0.7,0.2,1)",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 36,
          height: 36,
          flexShrink: 0,
          borderRadius: "50%",
          backgroundColor: "rgba(201,146,42,0.18)",
          color: COLOR.amber,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {config.icon}
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: FONT.sm, fontWeight: FONT.bold, color: COLOR.text, marginBottom: 2 }}>
          {config.title}
        </div>
        <div style={{ fontSize: FONT.xs, color: COLOR.textMuted, lineHeight: 1.45 }}>
          {config.body}
        </div>
      </div>

      {config.actionLabel && (
        <button
          onClick={goFullscreen}
          style={{
            backgroundColor: COLOR.amber,
            color: COLOR.navyDeep,
            border: "none",
            borderRadius: RADIUS.md,
            padding: `${SPACE.sm}px ${SPACE.md}px`,
            fontFamily: FONT.sans,
            fontSize: FONT.xs,
            fontWeight: FONT.bold,
            cursor: "pointer",
            flexShrink: 0,
            WebkitTapHighlightColor: "transparent",
          }}
        >
          {config.actionLabel}
        </button>
      )}

      <button
        onClick={dismiss}
        aria-label="Dismiss"
        style={{
          width: 28,
          height: 28,
          flexShrink: 0,
          borderRadius: "50%",
          backgroundColor: "transparent",
          border: `1px solid ${COLOR.border}`,
          color: COLOR.textMuted,
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          WebkitTapHighlightColor: "transparent",
        }}
      >
        <X size={14} strokeWidth={2.4} aria-hidden />
      </button>
    </div>
  );
}

function pickContent(platform: Platform, fullscreenSupported: boolean): {
  icon: ReactElement;
  title: string;
  body: ReactNode;
  actionLabel?: string;
} {
  if (platform === "ios") {
    return {
      icon: <Share size={16} strokeWidth={2} aria-hidden />,
      title: "Get the full-screen experience",
      body: (
        <>
          Tap <strong>Share</strong> in Safari, then <strong>"Add to Home Screen"</strong>. NeverMiss launches full-screen — no Safari chrome.
        </>
      ),
    };
  }
  if (platform === "android") {
    return {
      icon: <Smartphone size={16} strokeWidth={2} aria-hidden />,
      title: "Install for full-screen mode",
      body: (
        <>
          Open Chrome menu → <strong>"Install app"</strong> or <strong>"Add to Home Screen"</strong> for the full-screen experience.
        </>
      ),
    };
  }
  // Desktop
  return {
    icon: <Maximize2 size={16} strokeWidth={2} aria-hidden />,
    title: "Tap to go full-screen",
    body: <>Hide your browser chrome and use the entire window for reading.</>,
    actionLabel: fullscreenSupported ? "Go full-screen" : undefined,
  };
}
