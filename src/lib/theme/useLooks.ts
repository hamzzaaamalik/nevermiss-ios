import { useSyncExternalStore } from "react";
import { getLibraryStyle, getLook, subscribeLooks, type LibraryStyle, type LookId } from "./looks";

/** The current look and Library style; the component redraws when either changes. */
export function useLooks(): { look: LookId; style: LibraryStyle } {
  const look = useSyncExternalStore(subscribeLooks, getLook, getLook);
  const style = useSyncExternalStore(subscribeLooks, getLibraryStyle, getLibraryStyle);
  return { look, style };
}
