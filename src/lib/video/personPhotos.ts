import { useSyncExternalStore } from "react";
import type { VideoPerson } from "./types";

/**
 * The photo to show in a video tile while that person's camera is off or
 * their video hasn't arrived (Build 44). Grandchildren have photos from
 * setup; a big letter on flat blue looked unfinished in Rick's Build 43
 * screenshots. The app sets the current child's photo here.
 */
const photos: Partial<Record<VideoPerson, string | null>> = {};
const listeners = new Set<() => void>();

export function setPersonPhoto(person: VideoPerson, url: string | null | undefined): void {
  const next = url || null;
  if ((photos[person] ?? null) === next) return;
  photos[person] = next;
  for (const l of listeners) l();
}

function subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

export function usePersonPhoto(person: VideoPerson): string | null {
  return useSyncExternalStore(subscribe, () => photos[person] ?? null, () => null);
}
