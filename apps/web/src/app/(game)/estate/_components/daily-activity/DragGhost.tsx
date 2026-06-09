"use client";

import type { DragState } from "./usePointerDrag";

/**
 * The chip that follows the pointer during a drag, shared by the drag-enabled
 * games (assignment, ordering). Renders nothing when no drag is in flight.
 */
export function DragGhost({ dragging, label }: { dragging: DragState | null; label: string }) {
  if (!dragging) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed z-50 rounded-lg border border-border-gold bg-surface-overlay px-3 py-1.5 text-sm font-semibold text-text-gold shadow-lg"
      style={{ left: dragging.x - dragging.offsetX, top: dragging.y - dragging.offsetY }}
    >
      {label}
    </div>
  );
}
