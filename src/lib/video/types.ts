export type VideoRole = "nana" | "perry";
export type VideoPerson = "nana" | "child";
export type ConnectionQuality = "good" | "warning" | "bad" | "unknown";
export type SessionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "audio-only"
  | "reconnecting"
  | "error";

export const QUALITY_COLOR: Record<ConnectionQuality, string> = {
  good: "#22c55e",
  warning: "#eab308",
  bad: "#ef4444",
  unknown: "#94a3b8",
};

export const QUALITY_LABEL: Record<ConnectionQuality, string> = {
  good: "Connection: strong",
  warning: "Connection: degraded",
  bad: "Connection: weak",
  unknown: "Connection: not connected",
};

export function personToRole(person: VideoPerson): VideoRole {
  return person === "nana" ? "nana" : "perry";
}

export function roleToPerson(role: VideoRole): VideoPerson {
  return role === "nana" ? "nana" : "child";
}

export function userIdForRole(connectionId: string, role: VideoRole): string {
  return `${connectionId}:${role}`;
}
