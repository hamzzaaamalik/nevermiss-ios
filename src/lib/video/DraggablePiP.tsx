import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

type Corner = "tl" | "tr" | "bl" | "br";

interface DraggablePiPProps {
  children: ReactNode;
  /** Stable key used to persist position in localStorage. */
  storageKey?: string;
  /** Initial corner before any user drag. Default "tr" (top-right). */
  defaultCorner?: Corner;
  /** Margin from each edge in px. Default 14. */
  margin?: number;
  /** Visible when true. Default true — caller can hide e.g. during silly-faces mode. */
  visible?: boolean;
  /** Optional className to forward to the outer container. */
  className?: string;
  zIndex?: number;
}

const CORNERS: Corner[] = ["tl", "tr", "bl", "br"];

/**
 * FaceTime-style picture-in-picture wrapper. Wrap any element to make it
 * draggable around its parent — release lets it snap to whichever corner
 * is closest. Works with mouse and touch. Position persists per-storageKey.
 *
 * Mounts as a position:absolute layer inside its parent (parent must be
 * position:relative). Doesn't intercept page swipes or background events
 * outside its own bounds.
 */
export function DraggablePiP({
  children,
  storageKey = "nm_pip_corner",
  defaultCorner = "tr",
  margin = 14,
  visible = true,
  className,
  zIndex = 50,
}: DraggablePiPProps) {
  const [corner, setCorner] = useState<Corner>(() => {
    try {
      const v = localStorage.getItem(storageKey);
      if (v && CORNERS.includes(v as Corner)) return v as Corner;
    } catch {}
    return defaultCorner;
  });
  const [dragging, setDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);

  const ref = useRef<HTMLDivElement>(null);
  // Snap-target parent + rect captured at drag-start. We have to remember
  // them: while dragging, the element flips to `position: fixed`, which
  // makes `offsetParent` return `null` in most browsers, so reading it on
  // pointerup would fail and the tile would never snap to a corner.
  const dragStateRef = useRef<{
    startX: number;
    startY: number;
    pointerId: number | null;
    parentEl: HTMLElement | null;
    parentRect: DOMRect | null;
  }>({
    startX: 0,
    startY: 0,
    pointerId: null,
    parentEl: null,
    parentRect: null,
  });

  // Save corner whenever it changes.
  useEffect(() => {
    try { localStorage.setItem(storageKey, corner); } catch {}
  }, [corner, storageKey]);

  // Cleanup pointer listeners on unmount.
  useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // Avoid grabbing taps inside child controls (mic, camera, record).
    const targetEl = e.target as HTMLElement;
    if (targetEl.closest("button, [role='button'], input, select, textarea, a")) return;

    e.preventDefault();
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // Capture the snap-target NOW, while we're still position:absolute. The
    // moment dragging flips us to fixed, offsetParent will go null and we'd
    // lose the reference.
    const parentEl = (el.offsetParent as HTMLElement | null) ?? el.parentElement;
    const parentRect = parentEl?.getBoundingClientRect() ?? null;
    dragStateRef.current = {
      startX: e.clientX - rect.left,
      startY: e.clientY - rect.top,
      pointerId: e.pointerId,
      parentEl,
      parentRect,
    };
    setDragOffset({ x: rect.left, y: rect.top });
    setDragging(true);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  }

  function onPointerMove(e: PointerEvent) {
    if (dragStateRef.current.pointerId !== e.pointerId) return;
    setDragOffset({
      x: e.clientX - dragStateRef.current.startX,
      y: e.clientY - dragStateRef.current.startY,
    });
  }

  function onPointerUp(e: PointerEvent) {
    if (dragStateRef.current.pointerId !== e.pointerId) return;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    dragStateRef.current.pointerId = null;

    // Snap to nearest corner of the parent (the device frame). Use the
    // parent rect captured at drag-start — in the dragging state we're
    // position:fixed, which detaches us from offsetParent.
    const tile = ref.current?.getBoundingClientRect();
    const parentRect = dragStateRef.current.parentRect;
    if (tile && parentRect) {
      const tileCenterX = tile.left + tile.width / 2 - parentRect.left;
      const tileCenterY = tile.top + tile.height / 2 - parentRect.top;
      const isLeft = tileCenterX < parentRect.width / 2;
      const isTop = tileCenterY < parentRect.height / 2;
      const next: Corner = isTop ? (isLeft ? "tl" : "tr") : (isLeft ? "bl" : "br");
      setCorner(next);
    }
    // IMPORTANT: clear dragOffset BEFORE flipping `dragging` to false, so the
    // single re-render lands directly on the snapped corner-position style
    // (no flash of "left:0,top:0" between fixed and absolute).
    setDragOffset(null);
    setDragging(false);
    dragStateRef.current.parentEl = null;
    dragStateRef.current.parentRect = null;
  }

  if (!visible) return null;

  // Position style: while dragging, follow the cursor exactly. Released:
  // animate to the snap-corner with an easing curve.
  const positionStyle: React.CSSProperties = dragging && dragOffset
    ? {
        left: dragOffset.x,
        top: dragOffset.y,
        right: "auto",
        bottom: "auto",
        position: "fixed",
        transition: "none",
      }
    : {
        ...cornerStyle(corner, margin),
        position: "absolute",
        transition: "all 240ms cubic-bezier(0.32, 0.72, 0, 1)",
      };

  return (
    <div
      ref={ref}
      className={className}
      onPointerDown={onPointerDown}
      style={{
        ...positionStyle,
        zIndex,
        cursor: dragging ? "grabbing" : "grab",
        touchAction: "none",
        userSelect: "none",
        WebkitUserSelect: "none",
        willChange: "transform, left, top",
      }}
    >
      {children}
    </div>
  );
}

function cornerStyle(c: Corner, m: number): React.CSSProperties {
  switch (c) {
    case "tl": return { top: m, left: m };
    case "tr": return { top: m, right: m };
    case "bl": return { bottom: m, left: m };
    case "br": return { bottom: m, right: m };
  }
}
