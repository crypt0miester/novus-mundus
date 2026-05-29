"use client";

// useAnchoredPopover: the shared desktop-panel plumbing behind the war-table
// action menus (MessageActionsMenu, PlayerActionsMenu). It owns the three
// behaviours those menus would otherwise hand-roll identically:
//
//  - dismissal: outside-mousedown and Escape both call onClose (clicks on the
//    trigger or inside the panel are ignored);
//  - focus: the first menu item is focused on open, and focus returns to the
//    trigger only on a real open->close transition (the wasOpen guard stops the
//    last-mounted trigger of a many-menu thread from stealing page focus on
//    mount and fighting the auto-scroll);
//  - placement: the panel is portaled to <body> and fixed-positioned from the
//    trigger rect (so a clipping overflow ancestor cannot hide it), opening
//    below the trigger, flipping above when there is no room, and clamping to
//    the viewport. Recomputed on open, on scroll/resize, and whenever
//    `recalcKey` changes (e.g. a menu/picker view swap that resizes the panel).
//
// The mobile BottomSheet path owns its own dismissal and needs none of this.

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

export interface AnchoredPopover {
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  panelRef: React.RefObject<HTMLDivElement | null>;
  firstItemRef: React.RefObject<HTMLButtonElement | null>;
  menuId: string;
  // null until the panel has been measured; render it hidden until then.
  pos: { top: number; left: number } | null;
}

export function useAnchoredPopover(
  open: boolean,
  onClose: () => void,
  recalcKey?: unknown,
): AnchoredPopover {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const firstItemRef = useRef<HTMLButtonElement | null>(null);
  const menuId = useId();
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      firstItemRef.current?.focus();
    } else if (wasOpen.current) {
      triggerRef.current?.focus();
    }
    wasOpen.current = open;
  }, [open]);

  // recalcKey is an intentional re-measure trigger, not read in the effect body.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const t = triggerRef.current?.getBoundingClientRect();
      const p = panelRef.current?.getBoundingClientRect();
      if (!t || !p) return;
      const margin = 8;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // Open below the trigger, flipping above when there is not enough room.
      let top = t.bottom + 4;
      if (top + p.height > vh - margin) top = Math.max(margin, t.top - 4 - p.height);
      // Align near the trigger's left, clamped to the viewport on both sides.
      let left = t.left;
      if (left + p.width > vw - margin) left = vw - margin - p.width;
      if (left < margin) left = margin;
      setPos({ top, left });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, recalcKey]);

  return { triggerRef, panelRef, firstItemRef, menuId, pos };
}
