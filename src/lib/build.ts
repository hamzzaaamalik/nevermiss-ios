/** Shown in Settings and attached to every feedback report. Codemagic
 *  stamps its build number (the one TestFlight shows) at build time;
 *  local and web builds fall back to the last release's label. */
const stamped = String(import.meta.env.VITE_APP_BUILD ?? "").trim();
export const APP_BUILD = /^\d+$/.test(stamped) ? `Build ${stamped}` : "Build 36";
