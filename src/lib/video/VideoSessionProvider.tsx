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
import DailyIframe, { type DailyCall, type DailyEventObjectCameraError, type DailyEventObjectFatalError } from "@daily-co/daily-js";
import { DailyAudio, DailyProvider, useDaily, useDailyEvent } from "@daily-co/daily-react";
import { ReconnectBanner } from "./ReconnectBanner";
import { VideoDebugOverlay } from "./VideoDebugOverlay";
import { VideoHelpCard } from "./VideoHelpCard";
import { isPointerMsg, pointerBus, type PointerMsg } from "../reading/pointerBus";

const DEBUG_VIDEO =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("debug") === "video";
import { api } from "../api";
import { APP_BUILD } from "../build";
import type { SessionStatus, VideoProblem, VideoProblemKind, VideoRole } from "./types";

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

// Build 38: every video failure is reported to the admin inbox once per
// kind per app session, so a family that "just sees initials" (Rick's
// MacBook demo) leaves a trace we can act on.
const reportedKinds = new Set<string>();
// Automated tests run without a real Daily room; they turn the card off.
function helpCardSuppressed(): boolean {
  try { return localStorage.getItem("nm_video_help") === "off"; } catch { return false; }
}
function reportVideoProblem(problem: VideoProblem, role: VideoRole | null, connectionId: string | null) {
  if (reportedKinds.has(problem.kind)) return;
  reportedKinds.add(problem.kind);
  const nav = typeof navigator !== "undefined" ? navigator : null;
  let browser = "";
  try {
    const b = DailyIframe.supportedBrowser();
    browser = `${b.name} ${b.version} supported=${b.supported} mobile=${b.mobile}`;
  } catch {}
  const message = [
    `Video problem on the ${role === "perry" ? "child's" : "grandparent's"} device: ${problem.kind}.`,
    problem.detail ? `Detail: ${problem.detail}` : "",
    browser ? `Browser: ${browser}` : "",
    `Secure context: ${typeof window !== "undefined" ? String(window.isSecureContext) : "?"}`,
    nav ? `User agent: ${nav.userAgent}` : "",
  ].filter(Boolean).join("\n");
  api.feedback.submit({
    message,
    category: "bug",
    subject: `video:${problem.kind}`,
    senderRole: role === "perry" ? "child" : "nana",
    connectionId: connectionId ?? undefined,
    pageContext: `video role=${role ?? "?"}`,
    appVersion: APP_BUILD,
  }).catch(() => {});
}

/** Checks that need no call object: an insecure page or a browser Daily
 *  can't run in never gets as far as creating one. */
function preflightProblem(): VideoProblem | null {
  if (typeof window === "undefined") return null;
  if (window.isSecureContext === false) {
    return { kind: "insecure", detail: window.location.origin };
  }
  try {
    const b = DailyIframe.supportedBrowser();
    if (!b.supported) return { kind: "unsupported", detail: `${b.name} ${b.version}` };
  } catch {}
  if (!navigator.mediaDevices?.getUserMedia) {
    return { kind: "unsupported", detail: "navigator.mediaDevices missing" };
  }
  return null;
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
  /** True when this device has more than one camera (front + back). */
  canFlipCamera: boolean;
  /** Switch to the other camera (Show & Tell: show a pet or a project). */
  flipCamera: () => void;
  /** Back to the camera the call started with. No-op when not flipped. */
  resetCamera: () => void;
  isCameraFlipped: boolean;
  /** Current local video problem, if any (drives the help card). */
  problem: VideoProblem | null;
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
  canFlipCamera: false,
  flipCamera: () => {},
  resetCamera: () => {},
  isCameraFlipped: false,
  problem: null,
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
 * state — every failure path here is non-blocking, but no longer silent:
 * a large help card explains what to do on the device that failed.
 */
export function VideoSessionProvider({
  connectionId,
  role,
  enabled = true,
  children,
}: VideoSessionProviderProps) {
  const [callObject, setCallObject] = useState<DailyCall | null>(null);
  // Problems found before (or instead of) a call object.
  const [preProblem, setPreProblem] = useState<VideoProblem | null>(null);
  const [helpDismissed, setHelpDismissed] = useState(false);
  const [createAttempt, setCreateAttempt] = useState(0);

  // Owns the Daily call object lifecycle. The async creation matters —
  // we MUST await any prior destroy() before calling createCallObject(),
  // otherwise Daily's "Duplicate DailyIframe instances" guard fires the
  // moment SSE flickers `enabled` during a book switch. The previous
  // useMemo version couldn't await and was the root cause of the
  // Three Little Pigs crash + "3 black tiles" reconnect regression.
  useEffect(() => {
    if (!enabled) {
      setCallObject(null);
      setPreProblem(null);
      return;
    }
    const pre = preflightProblem();
    if (pre) {
      setPreProblem(pre);
      reportVideoProblem(pre, role, connectionId);
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
        setPreProblem(null);
      } catch (err) {
        console.error("[video] createCallObject failed:", err);
        const p: VideoProblem = { kind: "unsupported", detail: err instanceof Error ? err.message : String(err) };
        setPreProblem(p);
        reportVideoProblem(p, role, connectionId);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, createAttempt]);

  const retryCreate = useCallback(() => {
    setHelpDismissed(false);
    // An unsupported or insecure page won't fix itself in place.
    if (preProblem && (preProblem.kind === "insecure" || preProblem.kind === "unsupported")) {
      window.location.reload();
      return;
    }
    setCreateAttempt(n => n + 1);
  }, [preProblem]);

  if (!callObject || !enabled) {
    return (
      <VideoSessionContext.Provider
        value={{
          status: preProblem ? "error" : "idle",
          role,
          connectionId,
          isAudioOnly: false,
          isMicEnabled: true,
          isCameraEnabled: true,
          setMicEnabled: () => {},
          setCameraEnabled: () => {},
          canFlipCamera: false,
          flipCamera: () => {},
          resetCamera: () => {},
          isCameraFlipped: false,
          problem: enabled ? preProblem : null,
        }}
      >
        {children}
        {enabled && preProblem && !helpDismissed && !helpCardSuppressed() && (
          <VideoHelpCard problem={preProblem} onRetry={retryCreate} onDismiss={() => setHelpDismissed(true)} />
        )}
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

function cameraProblemFrom(ev: DailyEventObjectCameraError | undefined): VideoProblem {
  const type = ev?.error?.type;
  const detail = ev?.errorMsg?.errorMsg ?? ev?.error?.msg;
  let kind: VideoProblemKind = "camera-unknown";
  if (type === "permissions") kind = "blocked";
  else if (type === "cam-in-use" || type === "cam-mic-in-use" || type === "mic-in-use") kind = "in-use";
  else if (type === "not-found") kind = "not-found";
  else if (type === "undefined-mediadevices") kind = "unsupported";
  return { kind, detail: detail ? String(detail) : type };
}

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
  const [micEnabled, setMicEnabledState] = useState(true);
  const [cameraEnabled, setCameraEnabledState] = useState(true);
  const [problem, setProblem] = useState<VideoProblem | null>(null);
  const [helpDismissed, setHelpDismissed] = useState(false);
  const [canFlipCamera, setCanFlipCamera] = useState(false);
  const [isCameraFlipped, setIsCameraFlipped] = useState(false);
  const originalCameraIdRef = useRef<string | null>(null);

  const cancelledRef = useRef(false);
  const retryAttemptsRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  // Ejected because the same person joined again elsewhere: don't fight
  // the newer device by rejoining on our own.
  const ejectedRef = useRef(false);
  const micRef = useRef(micEnabled);
  micRef.current = micEnabled;
  const camRef = useRef(cameraEnabled);
  camRef.current = cameraEnabled;

  const raise = useCallback((p: VideoProblem) => {
    setProblem(p);
    setHelpDismissed(false);
    reportVideoProblem(p, role, connectionId);
  }, [role, connectionId]);

  const join = useCallback(async () => {
    if (!daily || !connectionId || !role) return;
    if (retryTimerRef.current !== null) { window.clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
    cancelledRef.current = false;
    ejectedRef.current = false;
    setStatus("connecting");
    try {
      // Fresh credentials on every attempt: an expired token or a room
      // that was recreated is exactly what a retry needs to recover from.
      const creds = await api.video.getCredentials(connectionId, role);
      if (cancelledRef.current) return;
      // Join with camera and mic off, then turn them on. A blocked or
      // busy camera then raises camera-error without failing the join,
      // so the call (and audio) still connects.
      await daily.join({
        url: creds.roomUrl,
        token: creds.token,
        startVideoOff: true,
        startAudioOff: true,
      });
      if (cancelledRef.current) return;
      retryAttemptsRef.current = 0;
      setStatus("connected");
      try { daily.setLocalAudio(micRef.current); } catch {}
      try { daily.setLocalVideo(camRef.current); } catch {}
    } catch (err) {
      if (cancelledRef.current) return;
      console.error("[video] join failed", err);
      setStatus("error");
      const attempt = ++retryAttemptsRef.current;
      if (attempt === 3) {
        raise({ kind: "join-failed", detail: err instanceof Error ? err.message : String(err) });
      }
      // Exponential backoff retry — never blocks reading.
      const delay = Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), RETRY_MAX_MS);
      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = null;
        if (!cancelledRef.current) void daily.leave().catch(() => {}).then(() => join());
      }, delay);
    }
  }, [daily, connectionId, role, raise]);

  useEffect(() => {
    void join();
    return () => {
      cancelledRef.current = true;
      if (retryTimerRef.current !== null) { window.clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
      daily?.leave().catch(() => {});
    };
    // intentionally not depending on `join` itself — re-join only on
    // identity changes, not toggle changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daily, connectionId, role]);

  useDailyEvent("joining-meeting", () => setStatus("connecting"));
  useDailyEvent("joined-meeting", () => {
    retryAttemptsRef.current = 0;
    setStatus("connected");
    setProblem(p => (p && (p.kind === "join-failed" || p.kind === "ejected") ? null : p));
  });
  useDailyEvent("left-meeting", () => setStatus("idle"));

  useDailyEvent("error", (event: DailyEventObjectFatalError) => {
    const type = event?.error?.type;
    console.warn("[video] fatal error", type, event?.errorMsg);
    if (type === "ejected" || /eject/i.test(event?.errorMsg ?? "")) {
      ejectedRef.current = true;
      setStatus("idle");
      raise({ kind: "ejected", detail: event?.errorMsg });
      return;
    }
    setStatus("error");
    if (type === "meeting-full") raise({ kind: "join-failed", detail: "meeting-full" });
    // Leave, then rejoin with fresh credentials (join() fetches them).
    if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null;
      if (!cancelledRef.current) void daily?.leave().catch(() => {}).then(() => join());
    }, 3000);
  });

  useDailyEvent("camera-error", (event: DailyEventObjectCameraError) => {
    console.warn("[video] camera unavailable", event);
    raise(cameraProblemFrom(event));
  });

  // Camera came back (user allowed it, or closed FaceTime): drop the card.
  useDailyEvent("participant-updated", (event) => {
    if (!event?.participant?.local) return;
    const state = event.participant.tracks?.video?.state;
    if (state === "playable" || state === "sendable") {
      setProblem(p => (p && (p.kind === "blocked" || p.kind === "in-use" || p.kind === "camera-unknown" || p.kind === "not-found") ? null : p));
    }
  });

  useDailyEvent("network-connection", (event) => {
    if (event?.event === "interrupted") {
      setStatus("reconnecting");
    } else if (event?.event === "connected") {
      setStatus("connected");
    }
  });

  // Nana's token is the room owner. A child who reopened the app (or a
  // second tab) leaves a stale copy of the same person in the room; keep
  // only the newest so tiles bind to the live device (Build 38).
  const ejectStale = useCallback(() => {
    if (!daily || role !== "nana") return;
    let ps: ReturnType<DailyCall["participants"]>;
    try { ps = daily.participants(); } catch { return; }
    const groups = new Map<string, Array<{ id: string; at: number }>>();
    for (const [key, p] of Object.entries(ps)) {
      if (key === "local" || p.local) continue;
      const who = (p.user_name || p.user_id || "").toLowerCase();
      if (!who) continue;
      const at = p.joined_at ? new Date(p.joined_at).getTime() : 0;
      const list = groups.get(who) ?? [];
      list.push({ id: p.session_id, at });
      groups.set(who, list);
    }
    const updates: Record<string, { eject: true }> = {};
    for (const [who, list] of groups) {
      // A remote "Nana" while we are Nana is a stale tab of ours.
      const keep = who === "nana" ? 0 : 1;
      list.sort((a, b) => b.at - a.at);
      for (const stale of list.slice(keep)) updates[stale.id] = { eject: true };
    }
    if (Object.keys(updates).length > 0) {
      try { daily.updateParticipants(updates); } catch (e) { console.warn("[video] eject failed", e); }
    }
  }, [daily, role]);
  useDailyEvent("participant-joined", ejectStale);
  useEffect(() => { if (status === "connected") ejectStale(); }, [status, ejectStale]);

  // Watchdog — if we sit in `reconnecting`, `error` or unexpectedly
  // `idle` for too long, the Daily SDK has likely given up under the
  // hood and we won't recover without forcing a fresh leave + rejoin.
  // Rick: "Lost video on Nana's side — came back when I reinstalled."
  useEffect(() => {
    if (status !== "reconnecting" && status !== "error" && status !== "idle") return;
    const t = window.setTimeout(() => {
      if (cancelledRef.current || ejectedRef.current) return;
      void daily?.leave().catch(() => {}).then(() => {
        if (!cancelledRef.current) void join();
      });
    }, status === "idle" ? 8000 : 15000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // iOS Safari closes WebRTC connections aggressively when a tab is
  // backgrounded. On returning to foreground the Daily SDK may not
  // realize it's been disconnected. Force a refresh check.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      if (status === "connected" || status === "audio-only") return;
      if (!daily || !connectionId || !role || ejectedRef.current) return;
      void daily.leave().catch(() => {}).then(() => {
        if (!cancelledRef.current) void join();
      });
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, daily, connectionId, role]);

  // Reading pointer rides the call: Daily app messages are near-instant.
  // sendAppMessage throws when not joined; the bus then falls back to
  // the session stream.
  useEffect(() => {
    if (!daily || status !== "connected") return;
    pointerBus.setDailySender((m: PointerMsg) => {
      try { daily.sendAppMessage(m, "*"); return true; } catch { return false; }
    });
    return () => pointerBus.setDailySender(null);
  }, [daily, status]);
  useDailyEvent("app-message", (ev) => {
    if (isPointerMsg(ev?.data)) pointerBus.receive(ev.data);
  });

  // How many cameras this device has (front + back on an iPad).
  useEffect(() => {
    if (!daily) return;
    let cancelled = false;
    const count = () => {
      daily.enumerateDevices()
        .then(({ devices }) => {
          if (cancelled) return;
          setCanFlipCamera(devices.filter(d => d.kind === "videoinput").length > 1);
        })
        .catch(() => {});
    };
    count();
    daily.on("available-devices-updated", count);
    return () => { cancelled = true; daily.off("available-devices-updated", count); };
  }, [daily, status]);

  const flipCamera = useCallback(() => {
    if (!daily) return;
    void (async () => {
      try {
        if (!originalCameraIdRef.current) {
          const cur = await daily.getInputDevices();
          const cam = cur.camera as { deviceId?: string } | undefined;
          originalCameraIdRef.current = cam?.deviceId ?? null;
        }
        const r = await daily.cycleCamera({ preferDifferentFacingMode: true });
        const nowId = r?.device?.deviceId ?? null;
        setIsCameraFlipped(!!nowId && nowId !== originalCameraIdRef.current);
      } catch (e) {
        console.warn("[video] flip camera failed", e);
      }
    })();
  }, [daily]);

  const resetCamera = useCallback(() => {
    if (!daily || !isCameraFlipped) return;
    const id = originalCameraIdRef.current;
    void (async () => {
      try {
        if (id) await daily.setInputDevicesAsync({ videoDeviceId: id });
        else await daily.cycleCamera({ preferDifferentFacingMode: true });
      } catch (e) {
        console.warn("[video] restore camera failed", e);
      }
      setIsCameraFlipped(false);
    })();
  }, [daily, isCameraFlipped]);

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

  const retry = useCallback(() => {
    setHelpDismissed(false);
    setProblem(null);
    void daily?.leave().catch(() => {}).then(() => join());
  }, [daily, join]);

  const value = useMemo<VideoSessionContextValue>(
    () => ({
      status,
      role,
      connectionId,
      isAudioOnly: false,
      isMicEnabled: micEnabled,
      isCameraEnabled: cameraEnabled,
      setMicEnabled,
      setCameraEnabled,
      canFlipCamera,
      flipCamera,
      resetCamera,
      isCameraFlipped,
      problem,
    }),
    [status, role, connectionId, micEnabled, cameraEnabled, setMicEnabled, setCameraEnabled, canFlipCamera, flipCamera, resetCamera, isCameraFlipped, problem],
  );

  return (
    <VideoSessionContext.Provider value={value}>
      {children}
      {problem && !helpDismissed && !helpCardSuppressed() && (
        <VideoHelpCard problem={problem} onRetry={retry} onDismiss={() => setHelpDismissed(true)} />
      )}
    </VideoSessionContext.Provider>
  );
}
