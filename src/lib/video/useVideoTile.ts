import {
  useActiveSpeakerId,
  useLocalSessionId,
  useNetwork,
  useParticipantIds,
  useParticipantProperty,
} from "@daily-co/daily-react";
import type { ConnectionQuality, VideoPerson, VideoRole } from "./types";
import { personToRole, userIdForRole } from "./types";

interface UseVideoTileOpts {
  person: VideoPerson;
  connectionId: string | null;
}

export interface VideoTileState {
  /** Daily participant id, or null if that role hasn't joined yet. */
  participantId: string | null;
  /** Network quality (good / warning / bad / unknown). */
  quality: ConnectionQuality;
  /** True if this tile represents the local participant. */
  isLocal: boolean;
  /** True if Daily reports this participant as the active speaker right now. */
  isActiveSpeaker: boolean;
}

export function useVideoTile({ person, connectionId }: UseVideoTileOpts): VideoTileState {
  const role: VideoRole = personToRole(person);
  const expectedUserId = connectionId ? userIdForRole(connectionId, role) : null;
  // Fallback when user_id isn't a clean match: meeting tokens set
  // `user_name` to "Nana" or "Perry" — we accept it as a backstop. This
  // covers the case Rick saw where both sides were in the same Daily
  // room but neither tile resolved the remote participant ("Nana could
  // see her own pic and Perry could see her own pic but neither could
  // see the other"). With this fallback, even if Daily transiently
  // re-issues the user_id, the tile still binds.
  const expectedUserName = role === "nana" ? "Nana" : "Perry";

  const matchedIds = useParticipantIds({
    filter: (p) =>
      (Boolean(expectedUserId) && p.user_id === expectedUserId) ||
      p.user_name === expectedUserName,
  });
  const participantId = matchedIds[0] ?? null;

  const network = useNetwork();
  const quality = (network?.networkState ?? "unknown") as ConnectionQuality;

  const localId = useLocalSessionId();
  const activeSpeakerId = useActiveSpeakerId();

  const isLocal = Boolean(participantId && localId === participantId);
  const isActiveSpeaker = Boolean(participantId && activeSpeakerId === participantId);

  return { participantId, quality, isLocal, isActiveSpeaker };
}

/** True only when the participant's outbound video track is actively playable. */
export function useTrackPlayable(participantId: string): boolean {
  const state = useParticipantProperty(participantId, "tracks.video.state") as
    | "playable"
    | "loading"
    | "interrupted"
    | "off"
    | "blocked"
    | undefined;
  return state === "playable";
}

/** Mic-state probes split into their own hooks so callers don't pull data they don't need. */
export function useMicMuted(participantId: string): boolean {
  const state = useParticipantProperty(participantId, "tracks.audio.state") as
    | "playable"
    | "loading"
    | "interrupted"
    | "off"
    | "blocked"
    | undefined;
  return state !== "playable" && state !== "loading";
}

export function useCameraOff(participantId: string): boolean {
  const state = useParticipantProperty(participantId, "tracks.video.state") as
    | "playable"
    | "loading"
    | "interrupted"
    | "off"
    | "blocked"
    | undefined;
  // The badge should reliably appear whenever the OTHER side won't see
  // your face. Rick's complaint: "Camera-off badge appears but is not
  // reliably showing at session start." Including loading + interrupted
  // here means the badge surfaces immediately on join when the camera
  // hasn't started streaming yet, instead of flashing in late.
  if (state === undefined) return false; // pre-property — don't false-positive
  return state !== "playable";
}
