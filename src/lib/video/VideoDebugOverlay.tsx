import { useEffect, useState } from "react";
import {
  useDaily,
  useLocalSessionId,
  useNetwork,
  useParticipantIds,
} from "@daily-co/daily-react";
import { useVideoSession } from "./VideoSessionProvider";

interface VideoDebugOverlayProps {
  /** Render position. Default "bottom-right". */
  position?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
}

/**
 * Floating diagnostic overlay that surfaces every piece of state the video
 * pipeline depends on. Mount it inside any VideoSessionProvider — it'll
 * answer "is the call actually connected?" and "is there a participant
 * mismatch?" at a glance.
 *
 * Hidden in production builds. Show it in dev with `?debug=video` in the
 * URL, or unconditionally by mounting it.
 */
export function VideoDebugOverlay({ position = "bottom-right" }: VideoDebugOverlayProps) {
  const { status, connectionId, role, isAudioOnly, isMicEnabled, isCameraEnabled } = useVideoSession();
  const localId = useLocalSessionId();
  const allIds = useParticipantIds();
  const network = useNetwork();
  const daily = useDaily();
  const [meetingState, setMeetingState] = useState<string>("?");

  useEffect(() => {
    if (!daily) return;
    const update = () => setMeetingState(daily.meetingState());
    update();
    const events = ["joining-meeting", "joined-meeting", "left-meeting", "error"] as const;
    for (const e of events) daily.on(e, update);
    return () => {
      for (const e of events) daily.off(e, update);
    };
  }, [daily]);

  const pos: Record<string, React.CSSProperties> = {
    "top-left": { top: 12, left: 12 },
    "top-right": { top: 12, right: 12 },
    "bottom-left": { bottom: 12, left: 12 },
    "bottom-right": { bottom: 12, right: 12 },
  };

  return (
    <div
      role="region"
      aria-label="Video debug overlay"
      style={{
        position: "fixed",
        ...pos[position],
        zIndex: 9999,
        backgroundColor: "rgba(11,23,46,0.92)",
        border: "1px solid rgba(255,255,255,0.18)",
        borderRadius: 10,
        color: "#fff",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 11,
        padding: "10px 12px",
        backdropFilter: "blur(10px)",
        boxShadow: "0 8px 28px rgba(0,0,0,0.55)",
        maxWidth: 320,
        lineHeight: 1.5,
        pointerEvents: "auto",
      }}
    >
      <div style={{ color: "#C9922A", fontWeight: 700, marginBottom: 6, letterSpacing: "0.04em" }}>VIDEO DEBUG</div>
      <Row k="status" v={<Badge tone={statusTone(status)}>{status}</Badge>} />
      <Row k="dailyState" v={meetingState} />
      <Row k="connId" v={connectionId ? trim(connectionId, 22) : "—"} />
      <Row k="role" v={role ?? "—"} />
      <Row k="audioOnly" v={String(isAudioOnly)} />
      <Row k="mic" v={isMicEnabled ? "on" : "off"} />
      <Row k="camera" v={isCameraEnabled ? "on" : "off"} />
      <Row k="localId" v={localId ? trim(localId, 18) : "—"} />
      <Row k="participants" v={allIds.length ? `${allIds.length} (${allIds.map((id) => trim(id, 6)).join(", ")})` : "0"} />
      <Row k="network" v={network?.networkState ?? "?"} />
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span style={{ color: "rgba(247,240,227,0.55)" }}>{k}</span>
      <span>{v}</span>
    </div>
  );
}

function Badge({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span
      style={{
        color: tone,
        backgroundColor: `color-mix(in srgb, ${tone} 18%, transparent)`,
        padding: "1px 6px",
        borderRadius: 4,
        fontWeight: 700,
      }}
    >
      {children}
    </span>
  );
}

function statusTone(s: string): string {
  if (s === "connected") return "#22c55e";
  if (s === "audio-only" || s === "reconnecting" || s === "connecting") return "#eab308";
  if (s === "error") return "#ef4444";
  return "#94a3b8";
}

function trim(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 3) + "...";
}
