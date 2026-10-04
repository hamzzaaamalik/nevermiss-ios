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

/** Why this device's video isn't working (Build 38 help card). */
export type VideoProblemKind =
  | "blocked"        // camera / mic permission denied
  | "in-use"         // another app (FaceTime, Zoom) holds the camera
  | "not-found"      // no camera on this device
  | "unsupported"    // browser can't do WebRTC video calls
  | "insecure"       // page isn't https, so the browser hides the camera
  | "join-failed"    // couldn't reach or enter the call
  | "ejected"        // the same person joined from another device
  | "camera-unknown";

export interface VideoProblem {
  kind: VideoProblemKind;
  detail?: string;
}
