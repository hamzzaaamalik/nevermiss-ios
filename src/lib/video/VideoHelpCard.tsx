import type { VideoProblem } from "./types";

const NAVY = "#1B2B4B";
const CREAM = "#F7F0E3";

function platform(): "ipad-app" | "ios" | "mac-safari" | "mac-other" | "other" {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } };
  if (w.Capacitor?.isNativePlatform?.()) return "ipad-app";
  const touchMac = ua.includes("Mac") && "ontouchend" in document;
  if (/iPad|iPhone|iPod/.test(ua) || touchMac) return "ios";
  const isSafari = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(ua);
  if (ua.includes("Mac")) return isSafari ? "mac-safari" : "mac-other";
  return "other";
}

function copyFor(problem: VideoProblem): { title: string; lead: string; steps: string[] } {
  const where = platform();
  const allowSteps: string[] =
    where === "ipad-app"
      ? ["Open the iPad Settings app.", "Scroll down and tap NeverMiss.", "Turn on Camera and Microphone.", "Come back here and tap Try again."]
      : where === "ios"
        ? ["Open the iPad Settings app, then Safari.", "Tap Camera and choose Allow. Do the same for Microphone.", "Come back here and tap Try again."]
        : where === "mac-safari"
          ? [
              "In the Safari menu at the top, choose Settings for This Website.",
              "Set Camera and Microphone to Allow.",
              "Also check Apple menu → System Settings → Privacy & Security → Camera, and turn on Safari.",
              "Tap Try again.",
            ]
          : [
              "Click the camera icon in the address bar and choose Always allow.",
              "On a Mac, also check Apple menu → System Settings → Privacy & Security → Camera, and turn on your browser.",
              "Tap Try again.",
            ];
  switch (problem.kind) {
    case "blocked":
      return { title: "Your camera is turned off for NeverMiss", lead: "NeverMiss needs your camera and microphone so you can see each other.", steps: allowSteps };
    case "in-use":
      return {
        title: "Another app is using the camera",
        lead: "Only one app can use the camera at a time.",
        steps: ["Close FaceTime, Zoom, Photo Booth or any other video app.", "Tap Try again."],
      };
    case "not-found":
      return { title: "No camera found", lead: "This device doesn't seem to have a working camera.", steps: ["Plug in a camera, or use an iPad or a computer with one.", "Tap Try again."] };
    case "insecure":
      return {
        title: "Video can't start on this page",
        lead: "The browser only allows the camera on a secure (https://) page.",
        steps: ["Open NeverMiss from its https:// address.", "Or use the NeverMiss iPad app."],
      };
    case "unsupported":
      return {
        title: "This browser can't do video calls",
        lead: "Reading still works, but video needs an up-to-date browser.",
        steps: ["Use the newest Safari or Google Chrome.", "Or use the NeverMiss iPad app.", "Then tap Try again."],
      };
    case "join-failed":
      return {
        title: "The video call couldn't connect",
        lead: "Reading and pages still work while we keep trying.",
        steps: ["Check that Wi-Fi is on and working.", "Tap Try again."],
      };
    case "ejected":
      return {
        title: "Video moved to another device",
        lead: "The same person joined the call from another iPad or computer.",
        steps: ["If this is the device you want to use, tap Try again."],
      };
    default:
      return { title: "The camera isn't working", lead: "Something stopped the camera from starting.", steps: [...allowSteps.slice(0, -1), "Close other video apps.", "Tap Try again."] };
  }
}

/**
 * Large, plain-language help when this device's video fails (Build 38).
 * Rick's MacBook demo showed only initials on both sides with no hint of
 * why; this card says what happened and how to fix it, in big type.
 */
export function VideoHelpCard({ problem, onRetry, onDismiss }: { problem: VideoProblem; onRetry: () => void; onDismiss: () => void }) {
  const c = copyFor(problem);
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="nm-video-help-title"
      data-testid="video-help-card"
      data-kind={problem.kind}
      style={{
        position: "fixed", inset: 0, zIndex: 8500,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
        background: "rgba(8,15,30,0.72)",
        backdropFilter: "blur(3px)",
      }}
    >
      <div style={{
        width: "min(560px, 100%)",
        maxHeight: "calc(100% - 16px)", overflowY: "auto",
        background: "linear-gradient(180deg, #16264a 0%, #0f1d38 100%)",
        border: "1px solid rgba(201,146,42,0.45)",
        borderRadius: 22,
        padding: "26px 26px 22px",
        boxShadow: "0 24px 70px rgba(0,0,0,0.6)",
        fontFamily: "DM Sans, sans-serif",
        color: CREAM,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 10 }}>
          <span aria-hidden style={{
            width: 54, height: 54, borderRadius: 16, flexShrink: 0,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            background: "rgba(248,113,113,0.16)", border: "1px solid rgba(248,113,113,0.45)",
            fontSize: 28,
          }}>📷</span>
          <div id="nm-video-help-title" style={{ fontFamily: "Playfair Display, serif", fontSize: 26, fontWeight: 700, lineHeight: 1.2 }}>
            {c.title}
          </div>
        </div>
        <div style={{ fontSize: 18, lineHeight: 1.5, color: "rgba(247,240,227,0.85)", marginBottom: 14 }}>{c.lead}</div>
        <ol style={{ margin: "0 0 20px", paddingLeft: 24, display: "flex", flexDirection: "column", gap: 10 }}>
          {c.steps.map((s, i) => (
            <li key={i} style={{ fontSize: 18, lineHeight: 1.45 }}>{s}</li>
          ))}
        </ol>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={onRetry}
            style={{
              flex: "1 1 200px", minHeight: 60, borderRadius: 999, border: "none",
              background: "linear-gradient(135deg, #f7c95d 0%, #C9922A 60%, #d97706 100%)",
              color: NAVY, fontSize: 20, fontWeight: 800, cursor: "pointer", touchAction: "manipulation",
              boxShadow: "0 8px 24px rgba(201,146,42,0.4)",
            }}
          >
            Try again
          </button>
          <button
            type="button"
            onClick={onDismiss}
            style={{
              flex: "1 1 200px", minHeight: 60, borderRadius: 999,
              background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.25)",
              color: CREAM, fontSize: 18, fontWeight: 700, cursor: "pointer", touchAction: "manipulation",
            }}
          >
            Keep reading without video
          </button>
        </div>
      </div>
    </div>
  );
}
