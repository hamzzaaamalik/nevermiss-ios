// Base URL for the api-server. In dev the Vite proxy in
// `vite.config.ts:65` rewrites `/api` to `http://localhost:8080`, so the
// default keeps local development working untouched. In production
// builds, `VITE_API_BASE` (set in `.env.production`) points at the
// deployed api host (e.g. `https://api.nevermiss.family/api`).
const BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

// Bearer token auth — the iOS Capacitor WebView can't reliably keep
// cross-origin cookies (WKWebView ITP blocks them even with
// SameSite=None), so we ALSO send the session id as an Authorization
// header. The server reads either Bearer header OR the cookie, so
// browser flows (where cookies work) are unchanged. localStorage
// inside Capacitor's WebView IS persisted across app launches by iOS.
const SESSION_TOKEN_KEY = "nm_session_token";
let sessionToken: string | null = (() => {
  try { return localStorage.getItem(SESSION_TOKEN_KEY); } catch { return null; }
})();
function setSessionToken(tok: string | null) {
  sessionToken = tok;
  try {
    if (tok) localStorage.setItem(SESSION_TOKEN_KEY, tok);
    else localStorage.removeItem(SESSION_TOKEN_KEY);
  } catch {}
}

export class ApiError extends Error {
  status: number;
  reason?: string;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
    if (body && typeof body === "object" && "reason" in body) {
      this.reason = String((body as { reason: unknown }).reason);
    }
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body) headers["Content-Type"] = "application/json";
  if (sessionToken) headers["Authorization"] = `Bearer ${sessionToken}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (data as { error?: string }).error ?? "Request failed";
    throw new ApiError(message, res.status, data);
  }
  return data as T;
}

export interface SafeUser {
  id: string;
  email: string;
  phone: string | null;
  firstName: string;
  lastName: string;
  role: "nana" | "parent";
  displayName: string | null;
  createdAt: string;
}

export interface Connection {
  id: string;
  nanaId: string | null;
  parentId: string | null;
  status: "pending" | "active";
  inviteToken: string;
  inviteEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Child {
  id: string;
  connectionId: string;
  name: string;
  birthday: string | null;
  pin: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReadingSession {
  id: string;
  connectionId: string;
  /** Which sibling this session belongs to. Null only on legacy entries
   *  written before per-child tagging shipped. */
  childId?: string | null;
  bookId: string;
  startPage: number;
  endPage: number;
  sessionDate: string;
}

export const api = {
  auth: {
    me: () => req<{ user: SafeUser }>("GET", "/auth/me"),
    register: async (body: {
      firstName: string;
      lastName: string;
      displayName?: string;
      email: string;
      password: string;
      role: "nana" | "parent";
      phone?: string;
    }) => {
      const res = await req<{ user: SafeUser; sessionToken?: string }>("POST", "/auth/register", body);
      if (res.sessionToken) setSessionToken(res.sessionToken);
      return res;
    },
    login: async (body: { email: string; password: string }) => {
      const res = await req<{ user: SafeUser; sessionToken?: string }>("POST", "/auth/login", body);
      if (res.sessionToken) setSessionToken(res.sessionToken);
      return res;
    },
    logout: async () => {
      const res = await req<{ ok: boolean }>("POST", "/auth/logout");
      setSessionToken(null);
      return res;
    },
  },
  connections: {
    invite: () => req<{ connection: Connection; inviteToken: string }>("POST", "/connections/invite"),
    lookup: (token: string) =>
      req<{ valid: boolean; connectionId: string; nanaName: string; needsPin: boolean }>("GET", `/connections/lookup/${token}`),
    list: () => req<{ connections: Array<{ connection: Connection; nana: SafeUser | null }> }>("GET", "/connections"),
    activate: (token: string) => req<{ connection: Connection }>("POST", `/connections/activate/${token}`),
    status: (id: string) => req<{ status: "pending" | "active" }>("GET", `/connections/${id}/status`),
  },
  children: {
    create: (body: { connectionId: string; name: string; birthday: string | null; pin: string }) =>
      req<Child>("POST", "/children", body),
    list: (connectionId: string) => req<Child[]>("GET", `/children/${connectionId}`),
    pinLogin: (connectionId: string, pin: string) =>
      req<{ child: Child; nanaName: string; connectionId: string }>("POST", "/children/pin-login", { connectionId, pin }),
  },
  sessions: {
    publishEvent: (connectionId: string, type: string, payload: unknown) =>
      req<{ ok: boolean; subscribers: number }>("POST", `/sessions/${connectionId}/event`, { type, payload }),
    streamUrl: (connectionId: string) => `${BASE}/sessions/${connectionId}/stream`,
    /** Polling fallback for environments that buffer SSE (Cloudflare Quick Tunnels). */
    getState: (connectionId: string) =>
      req<{
        mode?: string;
        bookId?: string;
        page?: number;
        scheduleProposal?: { date: string; time: string; proposedBy: "nana" | "perry" };
        scheduleAccepted?: { nana: boolean; perry: boolean };
        goodbyeStartTime?: number;
        goodbyePhase?: number;
        readingTheme?: "day" | "sepia" | "night";
        /** Set by Nana's layout switcher; polled by Perry so layout choice
         *  survives SSE-buffered tunnels. */
        readingLayout?: string;
        /** "single" = one-page-per-tap, "double" = open-book spread.
         *  Nana toggles via the PageModeSwitcher dropdown; Perry mirrors. */
        pageMode?: "single" | "double";
        /** Which side of the current spread is showing in single-page
         *  mode. "L" or "R". Travels with `page` on page_change events
         *  so Perry's view shows the exact page Nana is on. */
        pageSide?: "L" | "R";
        /** Nana's font cycle (1 / 1.25 / 1.5). */
        fontScale?: number;
        /** Toggle on Nana's icebreaker view for showing Perry's prompts. */
        showChildIcebreakerPrompts?: boolean;
        /** True while a real session is live — set on session_started,
         *  cleared on session_end / session_reset. Gates other state. */
        sessionAlive?: boolean;
        /** Most recent activity ts on the server — used for idle expiry. */
        lastTouched?: number;
        lastReaction?: { emoji: string; from: "nana" | "perry"; ts: number };
        lastPointer?: { x: number; y: number; page: number; ts: number };
        lastWord?: { side: "L" | "R"; index: number; page: number; ts: number };
        lastSillyFilterNana?: string;
        lastSillyFilterPerry?: string;
        /** `host` identifies who initiated the current round so receivers
         *  can re-derive their own challengeHostRef (Round-N publisher).
         *  `startAt` (server clock) anchors the counting phase across
         *  iPads via the SSE-tracked server-clock offset. `endsAt`
         *  (server clock) anchors the 6-second holding phase so both
         *  iPads schedule their own setTimeout for the result reveal. */
        lastChallenge?: { state: string; countNum?: number; host?: "nana" | "perry"; startAt?: number; endsAt?: number; startTs?: number; ts: number };
        lastLaughWinner?: { who: "nana" | "perry"; ts: number };
        /** Set when a chapter-end celebration overlay is active. Cleared on
         *  dismiss. Both iPads show the overlay until the host clears it. */
        lastChapterEnd?: {
          chapterIndex: number;
          chapterTitle: string;
          /** Reflection question — replaces the old recap. */
          chapterQuestion: string;
          /** Next-chapter teaser. Omitted on the last chapter of the book. */
          chapterTeaser?: string;
          /** True when this card sits at the end of the final chapter. */
          isLastChapter: boolean;
          intendedNextPage: number;
          ts: number;
        };
        lastSessionEndTs?: number;
        lastSessionCompleteTs?: number;
        /** Stamped on every schedule_reset event. Polling fallback uses
         *  this so the OTHER side learns about a "Change time" tap even
         *  when the SSE event was buffered by a Cloudflare tunnel. */
        lastScheduleReset?: { by: "nana" | "perry"; ts: number };
        /** Stamped on every book_change OR phase_change carrying a
         *  bookId. Polling fallback uses this to force-sync the
         *  client even when the 1.5s anti-clobber guard on the plain
         *  state.bookId path would skip the apply. Same purpose as
         *  lastScheduleReset for the schedule flow. */
        lastBookChange?: { bookId: string; page?: number; ts: number };
        /** Which sibling Nana / Perry's PIN-login currently has active.
         *  Drives the per-child progress + session-log filters. Set
         *  server-side by the `active_child_change` SSE event AND by
         *  `POST /api/children/pin-login`. */
        activeChildId?: string;
        /** Server wall-clock time when this response was sent. Clients
         *  use it to estimate their server-clock offset (NTP-lite) so
         *  server-anchored timestamps (countdown startAt, holding
         *  endsAt) convert accurately to each iPad's local clock. */
        serverTs?: number;
      }>("GET", `/sessions/${connectionId}/state`),
  },
  video: {
    getCredentials: (connectionId: string, role: "nana" | "perry") =>
      req<{ roomUrl: string; token: string }>(
        "POST",
        `/video/${connectionId}/credentials`,
        { role },
      ),
  },
  progress: {
    /** When `childId` is provided, returns only that sibling's rows.
     *  Omitted = whole connection (parent overview / fallback). */
    all: (connectionId: string, childId?: string) =>
      req<{ progress: Array<{
        id: string;
        connectionId: string;
        /** Which sibling this row belongs to. Null on legacy rows
         *  written before multi-child support landed. */
        childId?: string | null;
        bookId: string;
        currentPage: number;
        /** 0-based chapter index for chapter books; null for picture books
         *  and flat books that don't use chapters. */
        chapterIndex?: number | null;
        lastReadAt: string;
      }> }>(
        "GET", `/progress/${connectionId}${childId ? `?childId=${encodeURIComponent(childId)}` : ""}`
      ),
  },
  sessionLog: {
    /** Optional `childId` filters the feed to one sibling — used by the
     *  per-child memory view + FamilyStoriesView. */
    list: (connectionId: string, childId?: string) =>
      req<{ sessions: ReadingSession[]; child: Child | null }>(
        "GET",
        `/session-log/${connectionId}${childId ? `?childId=${encodeURIComponent(childId)}` : ""}`,
      ),
    /** Saves a reading session AND updates the per-book progress row
     *  as a side-effect. `chapterIndex` is optional — client computes
     *  it for chapter books, omits for flat books. `childId` is the
     *  active sibling (defaults server-side to state.activeChildId,
     *  then to children[0]). */
    save: (connectionId: string, body: { bookId: string; startPage: number; endPage: number; chapterIndex?: number; childId?: string }) =>
      req<{ session: ReadingSession }>("POST", `/session-log/${connectionId}`, body),
    /** Delete a single reading-session row. Privacy Policy v3 §8
     *  (user's right to delete specific Memory Vault items). */
    remove: (sessionId: string) =>
      req<{ ok: boolean; sessionId: string }>("DELETE", `/session-log/${sessionId}`),
  },
  /** Memory Vault audio recordings. Capture pipeline is still being
   *  built — this client surface is wired now so the policy-required
   *  delete + listing flows work end-to-end the moment recordings start
   *  persisting. */
  recordings: {
    list: (connectionId: string) =>
      req<{ recordings: Array<{
        id: string;
        connectionId: string;
        childId: string | null;
        name: string;
        bookId: string | null;
        durationSec: number | null;
        sizeBytes: number | null;
        s3Key: string | null;
        consentAt: string;
        createdAt: string;
      }> }>("GET", `/recordings/${connectionId}`),
    /** Bilateral-consent flag is required server-side. */
    create: (connectionId: string, body: {
      bilateralConsent: true;
      name: string;
      childId?: string;
      bookId?: string;
      durationSec?: number;
      sizeBytes?: number;
      s3Key?: string;
    }) =>
      req<{ recording: unknown }>("POST", `/recordings/${connectionId}`, body),
    remove: (recordingId: string) =>
      req<{ ok: boolean; recordingId: string }>("DELETE", `/recordings/${recordingId}`),
  },
  /**
   * Privacy-policy-backed account controls. Each method here is the
   * runtime implementation of a commitment in NeverMiss Privacy Policy
   * v3 §8 ("Your Rights and Choices") — Apple App Store Guideline
   * 5.1.1(v) requires that policies don't promise functionality the
   * app doesn't actually deliver.
   */
  account: {
    /** Cascading hard delete of the user, every connection they own,
     *  every child profile on those connections, all session log
     *  entries, all progress rows. Server clears the session cookie
     *  in the same response. Immediate — no grace window. */
    delete: async () => {
      const res = await req<{ ok: boolean; deleted: { userId: string; connections: number } }>("DELETE", "/account");
      // Server-side session row is gone; client-side token must be too.
      setSessionToken(null);
      return res;
    },
    /** Single-blob JSON export of everything we hold on the user.
     *  Caller is responsible for triggering the browser download —
     *  use the dedicated download helper rather than this method
     *  when targeting a real file save. */
    export: () => req<unknown>("GET", "/account/export"),
    /** Drops every child profile + reading session + progress row tied
     *  to connections this user owns, WITHOUT deleting the adult
     *  account itself. Reversible by adding the child back later. */
    withdrawParentalConsent: () => req<{ ok: boolean; childrenRemoved: number; sessionsRemoved: number; progressRemoved: number }>("POST", "/account/withdraw-parental-consent"),
  },
};
