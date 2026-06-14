import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import DailyIframe, { type DailyCall } from "@daily-co/daily-js";
import { DailyAudio, DailyProvider, useDaily, useDailyEvent } from "@daily-co/daily-react";
import { ReconnectBanner } from "./ReconnectBanner";
import { VideoDebugOverlay } from "./VideoDebugOverlay";

const DEBUG_VIDEO =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("debug") === "video";
import { api } from "../api";
import type { SessionStatus, VideoRole } from "./types";

// Daily.co's SDK forbids more than one DailyIframe call object per page —
// `createCallObject()` throws "Duplicate DailyIframe instances are not
// allowed" otherwise. This happens easily because:
//   1) Vite HMR reloads this module without unmounting the old provider,
//      so a stale instance from the previous module version lingers.
//   2) React StrictMode mounts → unmounts → re-mounts components in dev.
//   3) Production: when SSE book_change overlaps an `enabled` flicker,
//      destroy() of the old object is still in flight when create() of
//      the new one runs — Daily throws Duplicate, Nana's tab dies
//      silently, and Perry sees the "3 of 4 tiles black" reconnect bug.
//
// `destroy()` is async, so the previous useMemo-based pattern couldn't
// wait for cleanup. We track the current call object in module scope
// AND any in-flight destroy promise, then `await` both before creating
// the next instance from inside a useEffect.
let activeCallObject: DailyCall | null = null;
let pendingDestroy: Promise<unknown> | null = null;

async function teardownActiveCallObject(): Promise<void> {
  if (pendingDestroy) {
    try { await pendingDestroy; } catch {}
    pendingDestroy = null;
  }
  if (activeCallObject) {
    const stale = activeCallObject;
    activeCallObject = null;
    pendingDestroy = stale.destroy().catch(() => {});
    try { await pendingDestroy; } catch {}
    pendingDestroy = null;
  }
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    void teardownActiveCallObject();
  });
}

interface VideoSessionContextValue {
  status: SessionStatus;
  role: VideoRole | null;
  connectionId: string | null;
  isAudioOnly: boolean;
  isMicEnabled: boolean;
  isCameraEnabled: boolean;
  setMicEnabled: (on: boolean) => void;
  setCameraEnabled: (on: boolean) => void;
}

const VideoSessionContext = createContext<VideoSessionContextValue>({
  status: "idle",
  role: null,
  connectionId: null,
  isAudioOnly: false,
  isMicEnabled: true,
  isCameraEnabled: true,
  setMicEnabled: () => {},
  setCameraEnabled: () => {},
});

export function useVideoSession(): VideoSessionContextValue {
  return useContext(VideoSessionContext);
}

interface VideoSessionProviderProps {
  connectionId: string | null;
  role: VideoRole | null;
  /** Disable the whole video subsystem (e.g. during onboarding). */
  enabled?: boolean;
  children: ReactNode;
}

/**
 * Top-level wrapper that owns the Daily call object and joins/leaves on
 * connectionId+role changes. Reading flow continues regardless of video
 * state — every failure path here is non-blocking.
 */
export function VideoSessionProvider({
  connectionId,
  role,
  enabled = true,
  children,
}: VideoSessionProviderProps) {
  const [callObject, setCallObject] = useState<DailyCall | null>(null);

  // Owns the Daily call object lifecycle. The async creation matters —
  // we MUST await any prior destroy() before calling createCallObject(),
  // otherwise Daily's "Duplicate DailyIframe instances" guard fires the
  // moment SSE flickers `enabled` during a book switch. The previous
  // useMemo version couldn't await and was the root cause of the
  // Three Little Pigs crash + "3 black tiles" reconnect regression.
  useEffect(() => {
    if (!enabled) {
      setCallObject(null);
      return;
    }
    let cancelled = false;
    let created: DailyCall | null = null;
    (async () => {
      await teardownActiveCallObject();
      if (cancelled) return;
      try {
        created = DailyIframe.createCallObject();
        activeCallObject = created;
      } catch (err) {
        console.error("[video] createCallObject failed:", err);
        return;
      }
      if (cancelled) {
        const c = created;
        created = null;
        if (activeCallObject === c) activeCallObject = null;
        c?.destroy().catch(() => {});
        return;
      }
      setCallObject(created);
    })();
    return () => {
      cancelled = true;
      const c = created;
      created = null;
      if (c) {
        if (activeCallObject === c) activeCallObject = null;
        pendingDestroy = c.destroy().catch(() => {});
      }
      setCallObject(null);
    };
  }, [enabled]);

  if (!callObject || !enabled) {
    return (
      <VideoSessionContext.Provider
        value={{
          status: "idle",
          role,
          connectionId,
          isAudioOnly: false,
          isMicEnabled: true,
          isCameraEnabled: true,
          setMicEnabled: () => {},
          setCameraEnabled: () => {},
        }}
      >
        {children}
      </VideoSessionContext.Provider>
    );
  }

  return (
    <DailyProvider callObject={callObject}>
      <SessionController connectionId={connectionId} role={role}>
        {children}
      </SessionController>
      {/* Renders <audio> elements for every remote participant — required
          for remote audio playback. Hidden, no UI. */}
      <DailyAudio />
      {/* Top-of-screen non-blocking banner during reconnects / errors. */}
      <ReconnectBanner />
      {DEBUG_VIDEO && <VideoDebugOverlay />}
    </DailyProvider>
  );
}

const RETRY_BASE_MS = 1500;
const RETRY_MAX_MS = 15000;

function SessionController({
  connectionId,
  role,
  children,
}: {
  connectionId: string | null;
  role: VideoRole | null;
  children: ReactNode;
}) {
  const daily = useDaily();
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [audioOnly, setAudioOnly] = useState(false);
  const [micEnabled, setMicEnabledState] = useState(true);
  const [cameraEnabled, setCameraEnabledState] = useState(true);

  const cancelledRef = useRef(false);
  const retryAttemptsRef = useRef(0);

  const join = useCallback(async () => {
    if (!daily || !connectionId || !role) return;
    cancelledRef.current = false;
    setStatus("connecting");
    try {
      const creds = await api.video.getCredentials(connectionId, role);
      if (cancelledRef.current) return;
      await daily.join({
        url: creds.roomUrl,
        token: creds.token,
        startVideoOff: audioOnly || !cameraEnabled,
        startAudioOff: !micEnabled,
      });
      retryAttemptsRef.current = 0;
      setStatus(audioOnly ? "audio-only" : "connected");
    } catch (err) {
      if (cancelledRef.current) return;
      console.error("[video] join failed", err);
      setStatus("error");
      // Exponential backoff retry — never blocks reading.
      const attempt = ++retryAttemptsRef.current;
      const delay = Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), RETRY_MAX_MS);
      setTimeout(() => {
        if (!cancelledRef.current) void join();
      }, delay);
    }
  }, [daily, connectionId, role, audioOnly, cameraEnabled, micEnabled]);

  useEffect(() => {
    void join();
    return () => {
      cancelledRef.current = true;
      daily?.leave().catch(() => {});
    };
    // intentionally not depending on `join` itself — re-join only on
    // identity changes, not toggle changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daily, connectionId, role]);

  useDailyEvent("joining-meeting", () => setStatus("connecting"));
  useDailyEvent("joined-meeting", () => {
    retryAttemptsRef.current = 0;
    setStatus(audioOnly ? "audio-only" : "connected");
  });
  useDailyEvent("left-meeting", () => setStatus("idle"));

  useDailyEvent("error", (event) => {
    console.warn("[video] fatal error → switching to audio-only", event);
    if (!audioOnly) {
      setAudioOnly(true);
      setStatus("audio-only");
      // Re-join with video off so we still have audio.
      void daily?.leave().then(() => join());
    }
  });

  useDailyEvent("camera-error", (event) => {
    console.warn("[video] camera unavailable", event);
  });

  useDailyEvent("network-connection", (event) => {
    if (event?.event === "interrupted") {
      setStatus("reconnecting");
    } else if (event?.event === "connected") {
      setStatus(audioOnly ? "audio-only" : "connected");
    }
  });

  // Watchdog — if we sit in `reconnecting` or `error` for too long, the
  // Daily SDK has likely given up under the hood and we won't recover
  // without forcing a fresh leave + rejoin. Rick: "Lost video on Nana's
  // side — came back when I reinstalled." The reinstall worked because
  // it dropped the stale Daily session. This achieves the same thing
  // without making the user reinstall.
  useEffect(() => {
    if (status !== "reconnecting" && status !== "error") return;
    const t = window.setTimeout(() => {
      if (cancelledRef.current) return;
      void daily?.leave().catch(() => {}).then(() => {
        if (!cancelledRef.current) void join();
      });
    }, 15000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // iOS Safari closes WebRTC connections aggressively when a tab is
  // backgrounded. On returning to foreground the Daily SDK may not
  // realize it's been disconnected. Force a refresh check.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      // If we're not currently connected and we have all the inputs we
      // need for a join, retry. Cheap to call when already connected
      // (Daily SDK no-ops a redundant rejoin).
      if (status === "connected" || status === "audio-only") return;
      if (!daily || !connectionId || !role) return;
      void daily.leave().catch(() => {}).then(() => {
        if (!cancelledRef.current) void join();
      });
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, daily, connectionId, role]);

  const setMicEnabled = useCallback(
    (on: boolean) => {
      setMicEnabledState(on);
      daily?.setLocalAudio(on);
    },
    [daily],
  );

  const setCameraEnabled = useCallback(
    (on: boolean) => {
      setCameraEnabledState(on);
      daily?.setLocalVideo(on);
    },
    [daily],
  );

  const value = useMemo<VideoSessionContextValue>(
    () => ({
      status,
      role,
      connectionId,
      isAudioOnly: audioOnly,
      isMicEnabled: micEnabled,
      isCameraEnabled: cameraEnabled,
      setMicEnabled,
      setCameraEnabled,
    }),
    [status, role, connectionId, audioOnly, micEnabled, cameraEnabled, setMicEnabled, setCameraEnabled],
  );

  return <VideoSessionContext.Provider value={value}>{children}</VideoSessionContext.Provider>;
}
