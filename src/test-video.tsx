import { useEffect, useState } from "react";
import { ArrowRight, Check, Copy, Headphones, Smartphone, Wifi, WifiOff } from "lucide-react";
import {
  FaceVideo,
  FaceVideoStage,
  VideoControls,
  VideoSessionProvider,
  getRoleLabel,
  useVideoSession,
} from "./lib/video";
import type { SessionStatus, VideoRole } from "./lib/video";

export function TestVideoPage() {
  const params = new URLSearchParams(window.location.search);
  const role = params.get("role");
  const connectionId = params.get("conn");

  if (role !== "nana" && role !== "grand" && role !== "perry") {
    return <Landing />;
  }
  if (!connectionId) {
    return <Landing message="Missing &conn= parameter — both windows must use the same conn value." />;
  }

  // Internal token role still uses "perry" for grandchild — keeps user_id stable
  // across tokens. Display role label is generic.
  const tokenRole: VideoRole = role === "nana" ? "nana" : "perry";

  return (
    <Shell>
      <SandboxHeader role={role as "nana" | "grand"} connectionId={connectionId} />
      <VideoSessionProvider connectionId={connectionId} role={tokenRole} enabled>
        <SandboxBody role={role as "nana" | "grand"} />
      </VideoSessionProvider>
    </Shell>
  );
}

const COLOR = {
  navy: "#0A1428",
  navyDeep: "#070F1F",
  panel: "#101D38",
  panelHover: "#152544",
  border: "rgba(255,255,255,0.10)",
  borderStrong: "rgba(255,255,255,0.18)",
  text: "#F7F0E3",
  textMuted: "rgba(247,240,227,0.66)",
  textDim: "rgba(247,240,227,0.42)",
  amber: "#C9922A",
  amberSoft: "rgba(201,146,42,0.14)",
  good: "#22c55e",
  warn: "#eab308",
  bad: "#ef4444",
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: COLOR.navy,
        backgroundImage:
          "radial-gradient(circle at 12% -10%, rgba(201,146,42,0.10), transparent 50%), radial-gradient(circle at 90% 110%, rgba(59,91,219,0.10), transparent 50%)",
        color: COLOR.text,
        fontFamily: "Inter, DM Sans, sans-serif",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "32px 20px 64px",
        gap: 28,
      }}
    >
      {children}
    </div>
  );
}

function Landing({ message }: { message?: string } = {}) {
  return (
    <Shell>
      <div style={{ width: "100%", maxWidth: 720, display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ textAlign: "center" }}>
          <BrandMark />
          <h1
            style={{
              margin: "16px 0 8px",
              fontFamily: "Playfair Display, serif",
              fontSize: 32,
              fontWeight: 700,
              letterSpacing: "-0.01em",
            }}
          >
            Video sandbox
          </h1>
          <p style={{ margin: 0, color: COLOR.textMuted, fontSize: 14, lineHeight: 1.6 }}>
            Two windows. Two roles. One Daily.co room. Verify end-to-end before
            shipping.
          </p>
        </div>

        {message && (
          <div
            role="alert"
            style={{
              padding: "12px 16px",
              border: `1px solid ${COLOR.bad}`,
              backgroundColor: "rgba(239,68,68,0.10)",
              borderRadius: 12,
              color: COLOR.text,
              fontSize: 13,
            }}
          >
            {message}
          </div>
        )}

        <div style={{ display: "grid", gap: 12 }}>
          <UrlCard role="nana" />
          <UrlCard role="grand" />
        </div>

        <Tip
          icon={<Smartphone size={14} aria-hidden />}
          title="Testing on mobile or another device"
          body={
            <>
              Use the LAN address below from any device on the same WiFi.
              iOS Safari needs HTTPS — run the cloudflared tunnel printed by
              your dev terminal and use that URL instead.
            </>
          }
        />

        <Tip
          icon={<Headphones size={14} aria-hidden />}
          title="One Chrome profile can't share a webcam between tabs"
          body={
            <>
              Open the two URLs in different browsers (Chrome + Firefox) or
              one regular + one incognito window.
            </>
          }
        />
      </div>
    </Shell>
  );
}

function BrandMark() {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: "6px 14px 6px 6px",
        borderRadius: 999,
        backgroundColor: "rgba(255,255,255,0.04)",
        border: `1px solid ${COLOR.border}`,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: COLOR.amber,
      }}
    >
      <span
        style={{
          width: 22,
          height: 22,
          borderRadius: "50%",
          backgroundColor: COLOR.amber,
          color: COLOR.navyDeep,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "Playfair Display, serif",
          fontWeight: 800,
          fontSize: 13,
        }}
      >
        N
      </span>
      <span>NeverMiss · localhost</span>
    </div>
  );
}

function UrlCard({ role }: { role: "nana" | "grand" }) {
  const path = `/?test=video&role=${role}&conn=demo-1`;
  const fullUrl = `${window.location.origin}${path}`;
  const [copied, setCopied] = useState(false);

  const meta = role === "nana"
    ? { label: "Grandparent", subtitle: "Click to open", accent: COLOR.amber, dot: COLOR.amber }
    : { label: "Grandchild", subtitle: "Open in another browser", accent: "#3B5BDB", dot: "#3B5BDB" };

  const copy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <a
      href={path}
      target="_blank"
      rel="noreferrer"
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        alignItems: "center",
        gap: 14,
        padding: "16px 18px",
        backgroundColor: COLOR.panel,
        border: `1px solid ${COLOR.border}`,
        borderRadius: 14,
        textDecoration: "none",
        color: COLOR.text,
        transition: "background-color 160ms ease, border-color 160ms ease, transform 160ms ease",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLAnchorElement).style.backgroundColor = COLOR.panelHover;
        (e.currentTarget as HTMLAnchorElement).style.borderColor = meta.accent;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLAnchorElement).style.backgroundColor = COLOR.panel;
        (e.currentTarget as HTMLAnchorElement).style.borderColor = COLOR.border;
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          backgroundColor: meta.accent,
          color: COLOR.navyDeep,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 700,
          fontSize: 16,
          letterSpacing: "-0.01em",
        }}
      >
        {meta.label[0]}
      </div>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: COLOR.text,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          {meta.label}
          <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: meta.dot }} />
        </div>
        <div
          style={{
            marginTop: 2,
            color: COLOR.textDim,
            fontSize: 12,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {fullUrl}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy URL"
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            border: `1px solid ${COLOR.border}`,
            backgroundColor: "transparent",
            color: copied ? COLOR.good : COLOR.textMuted,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            transition: "all 160ms ease",
          }}
        >
          {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
        </button>
        <ArrowRight size={16} aria-hidden style={{ color: COLOR.textDim }} />
      </div>
    </a>
  );
}

function Tip({ icon, title, body }: { icon: React.ReactNode; title: string; body: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        gap: 12,
        padding: "12px 14px",
        backgroundColor: "rgba(255,255,255,0.03)",
        border: `1px solid ${COLOR.border}`,
        borderRadius: 10,
        fontSize: 12,
        color: COLOR.textMuted,
        lineHeight: 1.55,
      }}
    >
      <span
        style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          backgroundColor: "rgba(255,255,255,0.04)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: COLOR.amber,
        }}
      >
        {icon}
      </span>
      <div>
        <div style={{ color: COLOR.text, fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{title}</div>
        <div>{body}</div>
      </div>
    </div>
  );
}

function SandboxHeader({ role, connectionId }: { role: "nana" | "grand"; connectionId: string }) {
  const display = role === "nana" ? "Grandparent" : "Grandchild";
  const dot = role === "nana" ? COLOR.amber : "#3B5BDB";
  return (
    <header style={{ width: "100%", maxWidth: 960, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <BrandMark />
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 12px",
            borderRadius: 999,
            backgroundColor: "rgba(255,255,255,0.05)",
            border: `1px solid ${COLOR.border}`,
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: dot }} />
          You are <strong style={{ color: COLOR.text }}>{display}</strong>
        </span>
      </div>
      <code
        style={{
          fontSize: 11,
          color: COLOR.textDim,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          backgroundColor: "rgba(255,255,255,0.04)",
          border: `1px solid ${COLOR.border}`,
          padding: "5px 10px",
          borderRadius: 8,
        }}
      >
        room: {connectionId}
      </code>
    </header>
  );
}

function SandboxBody({ role }: { role: "nana" | "grand" }) {
  return (
    <div style={{ width: "100%", maxWidth: 960, display: "flex", flexDirection: "column", gap: 20 }}>
      <StatusCard />

      <Section title="Reading-ribbon dual tile" subtitle="The 140 × 88 tiles that live in the in-app reading view.">
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <FaceVideo person="nana" width={140} height={88} label={getRoleLabel("nana")} borderRadius={10} compact />
          <FaceVideo person="child" width={140} height={88} label={getRoleLabel("child")} borderRadius={10} compact />
          {role === "nana" && (
            <div style={{ marginLeft: 4 }}>
              <VideoControls compact showRecording />
            </div>
          )}
        </div>
      </Section>

      <Section
        title="Big + PiP stage"
        subtitle="The composition used by chat / silly faces / goodbye / parent check views."
      >
        <div style={{ aspectRatio: "16 / 9", borderRadius: 16, overflow: "hidden", border: `1px solid ${COLOR.border}` }}>
          <FaceVideoStage
            bigPerson={role === "nana" ? "child" : "nana"}
            pipPerson={role === "nana" ? "nana" : "child"}
            bigFallback=""
            pipFallback=""
            bigName={role === "nana" ? getRoleLabel("child") : getRoleLabel("nana")}
          />
        </div>
        {role === "nana" && (
          <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
            <VideoControls showRecording />
          </div>
        )}
      </Section>

      <DebugPanel />
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        backgroundColor: COLOR.panel,
        border: `1px solid ${COLOR.border}`,
        borderRadius: 16,
        padding: 18,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14, gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: COLOR.text }}>{title}</h2>
          <p style={{ margin: "2px 0 0", fontSize: 12, color: COLOR.textDim }}>{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function StatusCard() {
  const { status, isAudioOnly, isMicEnabled, isCameraEnabled } = useVideoSession();
  const tone = statusTone(status);
  const Icon = status === "connected" ? Wifi : WifiOff;
  const headline = statusHeadline(status, isAudioOnly);

  return (
    <div
      style={{
        backgroundColor: COLOR.panel,
        border: `1px solid ${tone}`,
        borderRadius: 16,
        padding: "16px 18px",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 16,
        boxShadow: `0 0 0 4px color-mix(in srgb, ${tone} 9%, transparent)`,
        transition: "border-color 200ms ease, box-shadow 200ms ease",
      }}
    >
      <span
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          backgroundColor: `color-mix(in srgb, ${tone} 18%, transparent)`,
          color: tone,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon size={18} aria-hidden />
      </span>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: COLOR.text }}>{headline}</div>
        <div style={{ fontSize: 12, color: COLOR.textDim, marginTop: 2 }}>
          status <code style={{ color: tone }}>{status}</code>
        </div>
      </div>
      <Pill label="audio" value={isAudioOnly ? "audio-only" : "live"} on={!isAudioOnly} />
      <Pill label="mic" value={isMicEnabled ? "on" : "off"} on={isMicEnabled} />
      <Pill label="camera" value={isCameraEnabled ? "on" : "off"} on={isCameraEnabled} />
    </div>
  );
}

function Pill({ label, value, on }: { label: string; value: string; on: boolean }) {
  const dot = on ? COLOR.good : COLOR.bad;
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 10px",
        borderRadius: 999,
        backgroundColor: "rgba(255,255,255,0.04)",
        border: `1px solid ${COLOR.border}`,
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: dot }} />
      <span style={{ color: COLOR.textDim }}>{label}</span>
      <span style={{ color: COLOR.text }}>{value}</span>
    </div>
  );
}

function statusTone(status: SessionStatus): string {
  switch (status) {
    case "connected":
      return COLOR.good;
    case "audio-only":
    case "reconnecting":
      return COLOR.warn;
    case "error":
      return COLOR.bad;
    default:
      return "#94a3b8";
  }
}

function statusHeadline(status: SessionStatus, audioOnly: boolean): string {
  switch (status) {
    case "idle":
      return "Idle";
    case "connecting":
      return "Connecting…";
    case "connected":
      return audioOnly ? "Connected — audio only" : "Live";
    case "audio-only":
      return "Audio only — video unavailable";
    case "reconnecting":
      return "Reconnecting…";
    case "error":
      return "Connection error — retrying";
    default:
      return status;
  }
}

function DebugPanel() {
  const { status, isAudioOnly, role, connectionId } = useVideoSession();
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 2000);
    return () => clearInterval(t);
  }, []);

  return (
    <details
      style={{
        backgroundColor: COLOR.panel,
        border: `1px solid ${COLOR.border}`,
        borderRadius: 16,
        padding: "14px 18px",
        fontSize: 12,
        color: COLOR.textMuted,
      }}
    >
      <summary style={{ cursor: "pointer", color: COLOR.text, fontWeight: 600, fontSize: 13 }}>
        Debug
      </summary>
      <pre
        style={{
          marginTop: 10,
          marginBottom: 0,
          backgroundColor: "rgba(0,0,0,0.35)",
          padding: 12,
          borderRadius: 10,
          overflow: "auto",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        }}
      >
{`role:         ${role}
connectionId: ${connectionId}
status:       ${status}
audioOnly:    ${isAudioOnly}`}
      </pre>
    </details>
  );
}
