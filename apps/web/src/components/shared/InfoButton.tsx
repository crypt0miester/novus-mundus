"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { animate } from "animejs";
import { useAnchoredPopover } from "@/lib/hooks/useAnchoredPopover";
import { useReducedMotion } from "@/lib/hooks/useReducedMotion";
import { SETTLE } from "@/lib/motion/tokens";
import { cn } from "@/lib/utils";

interface InfoButtonProps {
  /** The explanation. Plain text or rich nodes (kept short, this is a tooltip). */
  children: ReactNode;
  /** Accessible label for the trigger. Defaults to "More info". */
  label?: string;
  /** Icon size in px. Defaults to 14 (sits inline with small body text). */
  size?: number;
  /** Extra classes on the trigger button. */
  className?: string;
}

/**
 * A small clickable "i" that pops a short explanation. Click (or tap) toggles it;
 * an outside tap or Escape closes it. The panel is portaled to <body> and
 * anchored to the trigger (flips above when there is no room, clamps to the
 * viewport), so it is never clipped by an overflow ancestor. The pop-in is an
 * anime.js fade + rise + scale (honouring reduced-motion).
 *
 * Drop it next to any label that needs a word of explanation:
 *   Networth <InfoButton>Your total on-chain value: NOVI, gems, and held units.</InfoButton>
 */
export function InfoButton({ children, label = "More info", size = 14, className }: InfoButtonProps) {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();
  const { triggerRef, panelRef, menuId, pos } = useAnchoredPopover(open, () => setOpen(false));

  // Animate the panel in once, when it first has a measured position. A layout
  // effect so the panel paints already-hidden (no flash at the wrong spot), and
  // opacity/transform are written imperatively (never via a React style prop, so
  // React can't fight the animation the way it did with the morph bar).
  const animated = useRef(false);
  useLayoutEffect(() => {
    if (!open) {
      animated.current = false;
      return;
    }
    const el = panelRef.current;
    if (!el || !pos || animated.current) return;
    animated.current = true;
    if (reduce) {
      el.style.opacity = "1";
      el.style.transform = "none";
      return;
    }
    el.style.opacity = "0";
    animate(el, {
      opacity: [0, 1],
      translateY: [8, 0],
      scale: [0.94, 1],
      duration: 220,
      ease: SETTLE,
    });
  }, [open, pos, reduce, panelRef]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full align-middle text-text-muted transition-colors hover:text-text-gold focus-visible:text-text-gold active:scale-90",
          className,
        )}
      >
        <Info style={{ width: size, height: size }} aria-hidden />
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            id={menuId}
            role="tooltip"
            style={{
              position: "fixed",
              top: pos?.top ?? -9999,
              left: pos?.left ?? -9999,
              zIndex: 80,
              transformOrigin: "center top",
            }}
            className="max-h-[60vh] max-w-[min(18rem,calc(100vw-1.5rem))] overflow-y-auto rounded-lg border border-border-default bg-[var(--nm-bg-bar)]/97 px-3 py-2 text-xs leading-snug text-text-secondary shadow-xl shadow-black/40 backdrop-blur"
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
