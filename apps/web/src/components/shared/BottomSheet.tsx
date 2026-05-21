"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { animate, spring } from "animejs";
import { useSheetStore } from "@/lib/store/sheet";

// The content area hugs its content but never grows past this slice of the
// viewport; taller content scrolls inside instead.
const MAX_HEIGHT_VH = 0.92;
// Background painted below the content so dragging up past full reveals more
// sheet, never the backdrop. Generous — over-drag is rubber-banded well short.
const FILLER_VH = 0.6;
const BACKDROP_MAX = 0.55;
// On release, the drag velocity is projected this far ahead to pick a detent.
const PROJECTION_MS = 150;
// Collapse only once the sheet would cover 10% or less of the viewport.
const DISMISS_VISIBLE_VH = 0.1;
// Resistance applied while dragging up past the fully-open position.
const OVERDRAG_DAMP = 0.5;

interface Detents {
  /** translateY (px) with the whole content visible. */
  full: number;
  /** translateY (px) with the content fully off-screen. */
  dismiss: number;
}

function nearestClamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * BottomSheet — a mobile bottom-sheet modal that drags like an iOS/Android
 * sheet. It opens at its full content height (capped at 92vh); drag up and it
 * springs back, drag down past the 10%-visible mark and it springs shut.
 * Background extends below the content, so over-dragging up expands the sheet
 * rather than exposing the backdrop. Desktop layouts render their own panel —
 * this is `lg:hidden`.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);

  // The translated element (with the filler background); the content region
  // inside it is what we measure for the detents.
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);

  // translateY is the single source of truth for position: anime writes
  // `pos.y` and every frame we mirror it onto the DOM.
  const pos = useRef({ y: 0 });
  const detents = useRef<Detents>({ full: 0, dismiss: 0 });
  const anim = useRef<ReturnType<typeof animate> | null>(null);
  const animating = useRef(false);
  const closing = useRef(false);
  const openRef = useRef(open);
  const drag = useRef<{
    pointerStartY: number;
    sheetStartY: number;
    lastY: number;
    lastT: number;
    velocity: number;
  } | null>(null);

  // Re-measure the content region and recompute snap points.
  const remeasure = useCallback(() => {
    const el = contentRef.current;
    detents.current = {
      full: 0,
      dismiss: el ? Math.round(el.offsetHeight) : 0,
    };
  }, []);

  // Mirror a translateY value onto the sheet and fade the backdrop with it.
  const paint = useCallback((y: number) => {
    const { dismiss } = detents.current;
    const sheet = sheetRef.current;
    const backdrop = backdropRef.current;
    if (sheet) sheet.style.transform = `translate3d(0, ${y}px, 0)`;
    if (backdrop) {
      const fade = dismiss > 0 ? nearestClamp((dismiss - y) / dismiss, 0, 1) : 1;
      backdrop.style.opacity = String(fade * BACKDROP_MAX);
    }
  }, []);

  // Spring the sheet to a target translateY; `onArrive` fires once it settles.
  const springTo = useCallback(
    (targetY: number, onArrive?: () => void) => {
      anim.current?.pause();
      if (prefersReducedMotion()) {
        pos.current.y = targetY;
        paint(targetY);
        onArrive?.();
        return;
      }
      animating.current = true;
      anim.current = animate(pos.current, {
        y: targetY,
        ease: spring({ stiffness: 140, damping: 20 }),
        onUpdate: () => paint(pos.current.y),
        onComplete: () => {
          animating.current = false;
          onArrive?.();
        },
      });
    },
    [paint],
  );

  // The single path that closes the sheet: spring it shut, then unmount —
  // unless `open` flipped back true mid-animation, in which case spring back.
  const dismiss = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    springTo(detents.current.dismiss, () => {
      closing.current = false;
      if (openRef.current) springTo(detents.current.full);
      else setMounted(false);
    });
  }, [springTo]);

  // `open` drives mount; closing always springs shut before unmounting.
  useEffect(() => {
    openRef.current = open;
    if (open) {
      closing.current = false;
      if (mounted) springTo(detents.current.full);
      else setMounted(true);
    } else if (mounted) {
      dismiss();
    }
  }, [open, mounted, dismiss, springTo]);

  // On mount, measure, start off-screen, then spring up to full height.
  useEffect(() => {
    if (!mounted) return;
    remeasure();
    pos.current.y = detents.current.dismiss;
    paint(pos.current.y);
    const id = requestAnimationFrame(() => springTo(detents.current.full));
    return () => cancelAnimationFrame(id);
  }, [mounted, remeasure, paint, springTo]);

  // Keep snap points honest when the content or viewport resizes under us.
  useEffect(() => {
    if (!mounted) return;
    const resync = () => {
      remeasure();
      if (drag.current || animating.current || closing.current) return;
      springTo(detents.current.full);
    };
    const ro = new ResizeObserver(resync);
    if (contentRef.current) ro.observe(contentRef.current);
    window.addEventListener("resize", resync);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", resync);
    };
  }, [mounted, remeasure, springTo]);

  useEffect(
    () => () => {
      anim.current?.pause();
    },
    [],
  );

  // While the sheet is painted — including the spring-shut animation — lift the
  // mobile top bars above the backdrop so they never flash dark behind it.
  useEffect(() => {
    if (!mounted) return;
    const { acquireMounted, releaseMounted } = useSheetStore.getState();
    acquireMounted();
    return releaseMounted;
  }, [mounted]);

  // Open intent is tracked separately — it drops the instant the sheet is
  // dismissed, before the close animation, so the mobile data bar collapses
  // immediately instead of lingering until the spring settles.
  useEffect(() => {
    if (!open) return;
    const { acquireOpen, releaseOpen } = useSheetStore.getState();
    acquireOpen();
    return releaseOpen;
  }, [open]);

  if (!mounted) return null;

  const onPointerDown = (e: ReactPointerEvent) => {
    anim.current?.pause();
    animating.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      pointerStartY: e.clientY,
      sheetStartY: pos.current.y,
      lastY: pos.current.y,
      lastT: performance.now(),
      velocity: 0,
    };
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const det = detents.current;
    let y = d.sheetStartY + (e.clientY - d.pointerStartY);
    // Dragging up past full is allowed — the filler background covers it — but
    // rubber-banded so it springs back. Down hard-stops at fully dismissed.
    if (y < det.full) y = det.full + (y - det.full) * OVERDRAG_DAMP;
    if (y > det.dismiss) y = det.dismiss;
    const now = performance.now();
    const dt = now - d.lastT;
    if (dt > 0) d.velocity = (y - d.lastY) / dt;
    d.lastY = y;
    d.lastT = now;
    pos.current.y = y;
    paint(y);
  };

  const onPointerUp = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    const det = detents.current;

    // Project the release velocity ahead, the way iOS picks a resting detent.
    const projected = Math.min(
      det.dismiss,
      pos.current.y + d.velocity * PROJECTION_MS,
    );

    // Collapse only once dragged (or flung) down far enough that 10% or less
    // of the viewport still shows the sheet — but never demand more than 60%
    // of the sheet's own height, so short sheets stay dismissable.
    const minVisible = Math.min(
      DISMISS_VISIBLE_VH * window.innerHeight,
      det.dismiss * 0.6,
    );
    if (projected >= det.dismiss - minVisible) {
      // Closing routes through `open` so the parent's state stays in sync;
      // the effect above then springs the sheet shut.
      onClose();
      return;
    }
    springTo(det.full);
  };

  return (
    <div
      className="lg:hidden fixed inset-0 z-50 overflow-hidden"
      role="dialog"
      aria-modal="true"
    >
      <div
        ref={backdropRef}
        className="absolute inset-0 bg-black"
        style={{ opacity: 0, willChange: "opacity" }}
        onClick={onClose}
      />

      {/* The translated element: content region + a tall background filler so
          dragging up past full reveals more sheet, never the backdrop. */}
      <div
        ref={sheetRef}
        className="absolute inset-x-0 overflow-hidden rounded-t-2xl border-t border-border-default bg-surface-raised shadow-2xl shadow-black/50"
        style={{
          bottom: `-${FILLER_VH * 100}vh`,
          paddingBottom: `${FILLER_VH * 100}vh`,
          transform: "translateY(100%)",
          willChange: "transform",
        }}
      >
        <div
          ref={contentRef}
          className="flex flex-col"
          style={{ maxHeight: `${MAX_HEIGHT_VH * 100}vh` }}
        >
          {/* Drag handle — the grab zone for the spring drag */}
          <div
            className="relative flex shrink-0 cursor-grab items-center justify-center pb-2 pt-3 active:cursor-grabbing"
            style={{ touchAction: "none" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <div className="h-1 w-10 rounded-full bg-zinc-600" />
            <button
              onClick={onClose}
              aria-label="Close"
              className="absolute right-3 top-2.5 rounded-full p-1 text-text-muted hover:text-text-primary"
            >
              &#10005;
            </button>
          </div>

          {title && (
            <div className="shrink-0 px-4 pb-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                {title}
              </h3>
            </div>
          )}

          {/* Bottom padding (`pb-24`) reserves clearance for the floating
              MorphTabBar (h-14 pill + safe-area offset, ~80px). Without it
              the bar at z-[60] would visually cover the tail of the content. */}
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-24">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
