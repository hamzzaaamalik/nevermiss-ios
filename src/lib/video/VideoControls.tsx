import type { CSSProperties, ReactNode } from "react";
import { useEffect, useState } from "react";
import { Disc, Mic, MicOff, Sparkles, Square, Video, VideoOff } from "lucide-react";
import { useDaily, useRecording } from "@daily-co/daily-react";
import { useVideoSession } from "./VideoSessionProvider";

interface VideoControlsProps {
  showRecording?: boolean;
  /** Show background-blur toggle button. Defaults to true. */
  showBlur?: boolean;
  /** Compact = icon-only round buttons, used inside dense ribbons. */
  compact?: boolean;
  /** When true, stack buttons in a single vertical column instead of
   *  a horizontal row. Used in slim sidebars (e.g. Reading mode's PiP
   *  sidebar) where the row would overflow horizontally and clip. */
  vertical?: boolean;
  /** Override align/justification when laying out outside a flex row. */
  style?: CSSProperties;
}

/**
 * Mic / camera / record controls. Render this only for Nana — the spec
 * says coaching prompts and recording control are Nana-side only.
 *
 * Background blur is delegated entirely to Daily's built-in processor
 * via `daily.updateInputSettings({video: {processor: {type:
 * 'background-blur', config: { strength }}}})`. Daily runs MediaPipe at
 * the source on Nana's device and encodes the blurred frames into the
 * outbound stream — Perry receives an already-blurred view natively
 * over WebRTC. No SSE sync, no client-side segmentation, no custom
 * canvas pipeline. If Daily's processor isn't available on the user's
 * browser (their docs: Chromium-based + improving Safari), the SDK
 * call either no-ops or throws — we surface the throw to the console
 * but don't fight it.
 */
export function VideoControls({
  showRecording = false,
  showBlur = true,
  compact = false,
  vertical = false,
  style,
}: VideoControlsProps) {
  const { isMicEnabled, isCameraEnabled, setMicEnabled, setCameraEnabled, status } = useVideoSession();
  const { isRecording, startRecording, stopRecording } = useRecording();
  const daily = useDaily();
  const [blurOn, setBlurOn] = useState<boolean>(() => {
    try { return localStorage.getItem("nm_video_blur") === "yes"; } catch { return false; }
  });

  // Apply persisted blur state once Daily is connected (handles the
  // "user had blur on last session, just rejoined" case).
  useEffect(() => {
    if (!daily || status !== "connected") return;
    void setDailyBlur(daily, blurOn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daily, status]);

  const toggleBlur = async () => {
    const next = !blurOn;
    setBlurOn(next);
    try { localStorage.setItem("nm_video_blur", next ? "yes" : "no"); } catch {}
    if (!daily) return;
    await setDailyBlur(daily, next);
  };

  // Treat reconnecting as still "live" so the buttons don't flicker between
  // enabled (opacity 1) and disabled (opacity 0.4) every time the network
  // hiccups. Only fully disable when the call object is idle or errored.
  const isLive = status !== "idle" && status !== "error";

  return (
    <div
      role="toolbar"
      aria-label="Video controls"
      style={{
        display: "flex",
        flexDirection: vertical ? "column" : "row",
        gap: vertical ? 4 : compact ? 8 : 10,
        alignItems: "center",
        ...style,
      }}
    >
      <ControlButton
        on={isMicEnabled}
        onClick={() => setMicEnabled(!isMicEnabled)}
        labelOn="Mute microphone"
        labelOff="Unmute microphone"
        shortLabel="Mic"
        IconOn={Mic}
        IconOff={MicOff}
        compact={compact}
        disabled={!isLive}
        accent="#22c55e"
      />
      <ControlButton
        on={isCameraEnabled}
        onClick={() => setCameraEnabled(!isCameraEnabled)}
        labelOn="Turn camera off"
        labelOff="Turn camera on"
        shortLabel="Cam"
        IconOn={Video}
        IconOff={VideoOff}
        compact={compact}
        disabled={!isLive}
        accent="#22c55e"
      />
      {/* Hide the Blur button entirely on browsers where Daily's processor
          won't run (iPad / iOS Safari, Mac Safari, Firefox). Rick: "Since
          it won't do anything on iPad, we should probably hide that button
          for now." The old behavior was to show the button + a desktop-only
          banner on tap, which made the feature feel broken on iPad. We
          still honor the persisted `nm_video_blur` localStorage so a Nana
          who turned blur on from Chrome desktop yesterday gets blur back
          automatically next time she joins from Chrome desktop — she just
          doesn't see a useless button on her iPad in between. */}
      {showBlur && processorSupported() && (
        <ControlButton
          on={blurOn}
          onClick={() => void toggleBlur()}
          labelOn="Background blur on"
          labelOff="Blur your background"
          shortLabel="Blur"
          IconOn={Sparkles}
          IconOff={Sparkles}
          compact={compact}
          disabled={!isLive}
          accent="#60a5fa"
        />
      )}
      {showRecording && (
        <ControlButton
          on={isRecording}
          onClick={() => {
            if (isRecording) {
              void stopRecording();
            } else {
              void startRecording({ layout: { preset: "default" } });
            }
          }}
          labelOn="Stop Recording"
          labelOff="Start Recording"
          shortLabel={isRecording ? "● Stop" : "○ Rec"}
          IconOn={Square}
          IconOff={Disc}
          compact={compact}
          disabled={!isLive}
          accent="#ef4444"
          pulseWhenOn
        />
      )}
    </div>
  );
}

/** True when Daily's background-blur processor is supported on the
 *  current browser. Per Daily's own docs the processor runs on
 *  Chromium-based desktop browsers and (improving) Safari; on
 *  iPad/iOS Safari and older Mac Safari it FAILS. Critically, when
 *  the processor fails Daily TURNS OFF THE CAMERA "to ensure the
 *  user is not broadcasting unintended content" — that's what was
 *  killing video transmission in both directions every time blur
 *  was toggled on iPad. Gate the API call so we never trigger that
 *  failure path on a known-unsupported browser. */
function processorSupported(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(ua);
  // iPadOS 13+ reports as Mac in the UA but is distinguishable by
  // having a touch interface on the document object.
  const isIPadOrIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (typeof document !== "undefined" && ua.includes("Mac") && "ontouchend" in document);
  return !isSafari && !isIPadOrIOS;
}

/**
 * Tell Daily to enable or disable its background-blur processor on the
 * local outbound video stream. Strength 0.5 matches Daily's own
 * example in the docs and is a noticeable but not extreme bokeh.
 * On browsers where the processor isn't supported (iPad Safari, Mac
 * Safari, Firefox), the call is skipped entirely — calling it anyway
 * would cause Daily to disable the camera when the processor fails
 * to start. The toggle UI still flips so users get feedback that
 * they tapped; the visible effect just doesn't appear on those
 * browsers, which is the honest vendor limitation.
 */
async function setDailyBlur(daily: ReturnType<typeof useDaily>, on: boolean): Promise<void> {
  if (!daily) return;
  // On browsers where Daily's processor isn't supported (iPad / iOS
  // Safari, Mac Safari, Firefox), we do nothing — no CSS whole-tile
  // fallback, since whole-tile blur is misleading vs the bg-only
  // effect users expect. The toggle still persists in localStorage
  // so blur engages automatically next time the user joins from a
  // supported desktop browser. UI shows a "desktop-only" hint when
  // the button is on in this state.
  if (!processorSupported()) return;
  try {
    await daily.updateInputSettings({
      video: {
        processor: on
          ? { type: "background-blur", config: { strength: 0.5 } }
          : { type: "none" },
      },
    } as Parameters<typeof daily.updateInputSettings>[0]);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[blur] daily.updateInputSettings failed", err);
  }
}

/** Top-of-screen banner shown when the user has tapped Blur on a
 *  browser where Daily's processor isn't supported (iPad / iOS Safari,
 *  Mac Safari, Firefox). We don't apply a CSS whole-tile blur as a
 *  fallback because that misrepresents the feature — it would blur
 *  the face too, which isn't what users expect from a "background
 *  blur" toggle. Instead we honestly tell them the feature is
 *  desktop-only and leave the toggle persisted so it engages
 *  automatically next time they join from a supported browser. */
function BlurDesktopOnlyNotice() {
  return (
    <div
      role="status"
      style={{
        position: "fixed",
        top: 12,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9999,
        padding: "8px 14px",
        background: "rgba(11,23,46,0.92)",
        border: "1px solid rgba(96,165,250,0.45)",
        borderRadius: 999,
        color: "rgba(247,240,227,0.92)",
        fontFamily: "Inter, DM Sans, sans-serif",
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: "0.01em",
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        maxWidth: "min(92vw, 460px)",
        textAlign: "center",
        pointerEvents: "none",
      }}
    >
      <span style={{ color: "#60a5fa", marginRight: 6 }}>✨</span>
      Background blur is only available on Chrome or Edge (desktop).
    </div>
  );
}

type IconType = (props: { size?: number; strokeWidth?: number; "aria-hidden"?: boolean }) => ReactNode;

function ControlButton({
  on,
  onClick,
  labelOn,
  labelOff,
  shortLabel,
  IconOn,
  IconOff,
  compact,
  disabled,
  accent,
  pulseWhenOn = false,
}: {
  on: boolean;
  onClick: () => void;
  labelOn: string;
  labelOff: string;
  /** 3–5 char tag shown under the icon in compact mode (e.g. "Mic", "Blur"). */
  shortLabel: string;
  IconOn: IconType;
  IconOff: IconType;
  compact: boolean;
  disabled: boolean;
  accent: string;
  pulseWhenOn?: boolean;
}) {
  const label = on ? labelOn : labelOff;
  const Icon = on ? IconOn : IconOff;
  const tone = on ? accent : "rgba(255,255,255,0.7)";
  const bg = on ? `color-mix(in srgb, ${accent} 18%, transparent)` : "rgba(255,255,255,0.06)";
  const border = on ? accent : "rgba(255,255,255,0.18)";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={on}
      style={{
        backgroundColor: bg,
        border: `1px solid ${border}`,
        color: tone,
        borderRadius: compact ? 14 : 12,
        width: compact ? 52 : undefined,
        height: compact ? 52 : 44,
        minWidth: compact ? 52 : 44,
        padding: compact ? "4px 0" : "0 16px",
        fontFamily: "Inter, DM Sans, sans-serif",
        fontSize: 12,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        display: "inline-flex",
        flexDirection: compact ? "column" : "row",
        alignItems: "center",
        justifyContent: "center",
        gap: compact ? 2 : 8,
        transition:
          "background-color 180ms ease, border-color 180ms ease, color 180ms ease, transform 120ms ease",
        boxShadow: on ? `0 0 0 4px color-mix(in srgb, ${accent} 12%, transparent)` : "none",
        animation: pulseWhenOn && on ? "video-status-dot 1.4s ease-in-out infinite" : undefined,
      }}
      onMouseEnter={(e) => {
        if (!disabled) (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)";
      }}
    >
      <Icon size={compact ? 16 : 16} strokeWidth={2} aria-hidden />
      {compact ? (
        <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: "0.04em", lineHeight: 1 }}>
          {shortLabel}
        </span>
      ) : (
        <span>{label}</span>
      )}
    </button>
  );
}
