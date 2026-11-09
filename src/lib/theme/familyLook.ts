/**
 * The family's look, shared by both iPads (Build 43).
 *
 * Nana chooses it; it is saved on the server for her family and the kids' iPad
 * follows: when it signs in or reconnects (GET .../look) and live through the
 * "look_change" event. If Nana's change can't reach the server (offline), it is
 * kept on her iPad as pending and sent the next time her family opens.
 */
import { api } from "../api";
import { getLibraryStyle, getLook, isLibraryStyle, isLookId, setLooks, type LibraryStyle, type LookId } from "./looks";

const PENDING_KEY = "nm_look_pending";
/** Nana's family on this iPad (set by the app when her family opens or is created). */
let familyId: string | null = null;
export function setLookFamily(id: string | null): void { familyId = id; }

/** Apply a look from the server or an event. Missing or unknown parts leave this iPad as it is. */
export function applyFamilyLook(v: { look?: unknown; libraryStyle?: unknown } | null | undefined): void {
  if (!v) return;
  const next: { look?: LookId; style?: LibraryStyle } = {};
  if (isLookId(v.look)) next.look = v.look;
  if (isLibraryStyle(v.libraryStyle)) next.style = v.libraryStyle;
  if (next.look || next.style) setLooks(next);
}

async function push(connectionId: string): Promise<void> {
  await api.connections.setLook(connectionId, { look: getLook(), libraryStyle: getLibraryStyle() });
  try { localStorage.removeItem(PENDING_KEY); } catch { /* fine */ }
}

/** Nana picks colours or a Library style: change this iPad now, then the family. */
export async function chooseFamilyLook(next: { look?: LookId; style?: LibraryStyle }): Promise<boolean> {
  setLooks(next);
  try { localStorage.setItem(PENDING_KEY, "1"); } catch { /* fine */ }
  if (!familyId) return false;
  try { await push(familyId); return true; } catch { return false; }
}

/** Nana's family has opened: send a change that didn't get through, or else take the family's look. */
export function syncFamilyLookOnOpen(connectionId: string, conn: { look?: unknown; libraryStyle?: unknown }): void {
  familyId = connectionId;
  let pending = false;
  try { pending = localStorage.getItem(PENDING_KEY) === "1"; } catch { /* fine */ }
  if (pending) { void push(connectionId).catch(() => { /* still pending; next time */ }); return; }
  applyFamilyLook(conn);
}

/** The kids' iPad: ask for the family's look (on sign-in and each time its event stream starts). */
export function fetchFamilyLook(connectionId: string): void {
  api.connections.getLook(connectionId).then(applyFamilyLook).catch(() => { /* older server or offline: keep this iPad's look */ });
}
