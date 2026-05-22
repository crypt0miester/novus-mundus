"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
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
// Programmatic settles — open, close, drag-release snap — play as Web
// Animations on `transform`/`opacity`, which the browser runs on the
// compositor thread. That keeps the slide at a steady 60fps even while a
// freshly-mounted sheet's content is still painting on the main thread (the
// JS spring this replaced janked badly there). ~420ms, firm decelerating curve.
const SETTLE_MS = 420;
const SETTLE_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";

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
 * eases back, drag down past the 10%-visible mark and it settles shut.
 * Background extends below the content, so over-dragging up expands the sheet
 * rather than exposing the backdrop. Desktop layouts render their own panel —
 * this is `lg:hidden`.
 *
 * The finger drag is tracked on the main thread; every other move — open,
 * close, drag-release snap — is a compositor-run Web Animation, so it stays
 * smooth even while the sheet's freshly-mounted content paints.
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

  // translateY is the position source of truth at rest and during a drag;
  // mid-settle the running Web Animation owns it (read back via `currentY`).
  const pos = useRef({ y: 0 });
  const detents = useRef<Detents>({ full: 0, dismiss: 0 });
  // The in-flight settle — one Animation per animated element.
  const sheetAnim = useRef<Animation | null>(null);
  const backdropAnim = useRef<Animation | null>(null);
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

  // `mounted` read without subscribing the `open` effect to it — that effect
  // must fire only on real `open` changes, never on the mount it triggers.
  const mountedRef = useRef(mounted);
  mountedRef.current = mounted;

  // Re-measure the content region and recompute snap points.
  const remeasure = useCallback(() => {
    const el = contentRef.current;
    detents.current = {
      full: 0,
      dismiss: el ? Math.round(el.offsetHeight) : 0,
    };
  }, []);

  // Backdrop opacity is a linear function of the sheet's translateY: fully
  // open → BACKDROP_MAX, fully dismissed → 0.
  const opacityFor = useCallback((y: number) => {
    const { dismiss } = detents.current;
    const fade = dismiss > 0 ? nearestClamp((dismiss - y) / dismiss, 0, 1) : 1;
    return fade * BACKDROP_MAX;
  }, []);

  // Mirror a translateY straight onto the DOM — used for drag frames and to
  // bake a settle's resting values into inline style once it finishes.
  const paint = useCallback(
    (y: number) => {
      const sheet = sheetRef.current;
      const backdrop = backdropRef.current;
      if (sheet) sheet.style.transform = `translate3d(0, ${y}px, 0)`;
      if (backdrop) backdrop.style.opacity = String(opacityFor(y));
    },
    [opacityFor],
  );

  // The sheet's translateY *right now* — the live interpolated value when a
  // settle is mid-flight, so a fresh settle or a grab picks up without a jump.
  const currentY = useCallback(() => {
    const sheet = sheetRef.current;
    if (!sheet) return pos.current.y;
    const t = getComputedStyle(sheet).transform;
    return t && t !== "none" ? new DOMMatrixReadOnly(t).m42 : pos.current.y;
  }, []);

  const currentOpacity = useCallback(() => {
    const backdrop = backdropRef.current;
    if (!backdrop) return 0;
    const o = parseFloat(getComputedStyle(backdrop).opacity);
    return Number.isFinite(o) ? o : 0;
  }, []);

  // Settle the sheet to a target translateY as a compositor-run Web Animation;
  // `onArrive` fires once it lands. Safe to call mid-flight — it reads the
  // live position and animates on from there.
  const settleTo = useCallback(
    (targetY: number, onArrive?: () => void) => {
      const sheet = sheetRef.current;
      const backdrop = backdropRef.current;

      // Where the sheet visually is now — mid-flight if a settle is running.
      const fromY = currentY();
      const fromOpacity = currentOpacity();

      // Drop any in-flight settle. `cancel()` never fires `onfinish`, so a
      // superseded settle's `onArrive` is correctly abandoned.
      sheetAnim.current?.cancel();
      backdropAnim.current?.cancel();
      sheetAnim.current = null;
      backdropAnim.current = null;

      pos.current.y = targetY;
      const toOpacity = opacityFor(targetY);

      if (!sheet || prefersReducedMotion() || fromY === targetY) {
        paint(targetY);
        animating.current = false;
        onArrive?.();
        return;
      }

      animating.current = true;
      const timing: KeyframeAnimationOptions = {
        duration: SETTLE_MS,
        easing: SETTLE_EASING,
        fill: "forwards",
      };

      const sa = sheet.animate(
        [
          { transform: `translate3d(0, ${fromY}px, 0)` },
          { transform: `translate3d(0, ${targetY}px, 0)` },
        ],
        timing,
      );
      sheetAnim.current = sa;
      if (backdrop) {
        backdropAnim.current = backdrop.animate(
          [{ opacity: fromOpacity }, { opacity: toOpacity }],
          timing,
        );
      }

      // The compositor owns the motion from here; the main thread is free to
      // paint freshly-mounted content without disturbing the slide.
      sa.onfinish = () => {
        if (sheetAnim.current !== sa) return;
        animating.current = false;
        // Bake the resting values into inline style, then release the
        // animations' hold so a later drag can write transform directly.
        paint(targetY);
        sheetAnim.current?.cancel();
        backdropAnim.current?.cancel();
        sheetAnim.current = null;
        backdropAnim.current = null;
        onArrive?.();
      };
    },
    [paint, currentY, currentOpacity, opacityFor],
  );

  // The single path that closes the sheet: settle it shut, then unmount —
  // unless `open` flipped back true mid-animation, in which case settle back.
  const dismiss = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    settleTo(detents.current.dismiss, () => {
      closing.current = false;
      if (openRef.current) settleTo(detents.current.full);
      else setMounted(false);
    });
  }, [settleTo]);

  // `open` drives mount; closing always settles shut before unmounting. A
  // layout effect, so the mount is requested in the same commit as the tap.
  // Keyed on `open` alone (mounted via ref) so it fires once per real open:
  // settling a *fresh* sheet up belongs to the mount effect below — here
  // only the re-open of an already-mounted sheet settles.
  useLayoutEffect(() => {
    openRef.current = open;
    if (open) {
      closing.current = false;
      if (mountedRef.current) settleTo(detents.current.full);
      else setMounted(true);
    } else if (mountedRef.current) {
      dismiss();
    }
  }, [open, dismiss, settleTo]);

  // On mount: measure and place the sheet off-screen *now*, in a layout effect
  // before the browser paints — so the heavy first paint of the sheet's
  // content lands on a frame where the sheet sits parked off-screen and still.
  // The settle is armed for the *next* frame, so it animates against
  // already-painted, already-layerised content. Being a compositor animation
  // it then stays smooth no matter how busy that content keeps the main thread.
  useLayoutEffect(() => {
    if (!mounted) return;
    remeasure();
    pos.current.y = detents.current.dismiss;
    paint(pos.current.y);
    const id = requestAnimationFrame(() => {
      if (openRef.current) settleTo(detents.current.full);
    });
    return () => cancelAnimationFrame(id);
  }, [mounted, remeasure, paint, settleTo]);

  // Keep snap points honest when the content or viewport resizes under us.
  useEffect(() => {
    if (!mounted) return;
    const resync = () => {
      remeasure();
      if (drag.current || animating.current || closing.current) return;
      settleTo(detents.current.full);
    };
    const ro = new ResizeObserver(resync);
    if (contentRef.current) ro.observe(contentRef.current);
    window.addEventListener("resize", resync);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", resync);
    };
  }, [mounted, remeasure, settleTo]);

  useEffect(
    () => () => {
      sheetAnim.current?.cancel();
      backdropAnim.current?.cancel();
    },
    [],
  );

  // While the sheet is painted — including the settle-shut animation — lift the
  // mobile top bars above the backdrop so they never flash dark behind it.
  useEffect(() => {
    if (!mounted) return;
    const { acquireMounted, releaseMounted } = useSheetStore.getState();
    acquireMounted();
    return releaseMounted;
  }, [mounted]);

  // Open intent is tracked separately from `mounted` — it drops the instant
  // the sheet is dismissed, before the close animation, so the mobile data bar
  // collapses immediately. Registering a `close` handler lets the MorphTabBar
  // surface a ✕ that dismisses this sheet.
  const sheetId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const { registerOpen, releaseOpen } = useSheetStore.getState();
    registerOpen({ id: sheetId, close: () => onCloseRef.current() });
    return () => releaseOpen(sheetId);
  }, [open, sheetId]);

  if (!mounted) return null;

  const onPointerDown = (e: ReactPointerEvent) => {
    // Pin the sheet wherever it visually is and drop any in-flight settle, so
    // finger tracking takes over without a jump.
    const y = currentY();
    sheetAnim.current?.cancel();
    backdropAnim.current?.cancel();
    sheetAnim.current = null;
    backdropAnim.current = null;
    animating.current = false;
    pos.current.y = y;
    paint(y);
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      pointerStartY: e.clientY,
      sheetStartY: y,
      lastY: y,
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
    const projected = Math.min(det.dismiss, pos.current.y + d.velocity * PROJECTION_MS);

    // Collapse only once dragged (or flung) down far enough that 10% or less
    // of the viewport still shows the sheet — but never demand more than 60%
    // of the sheet's own height, so short sheets stay dismissable.
    const minVisible = Math.min(DISMISS_VISIBLE_VH * window.innerHeight, det.dismiss * 0.6);
    if (projected >= det.dismiss - minVisible) {
      // Closing routes through `open` so the parent's state stays in sync;
      // the effect above then settles the sheet shut.
      onClose();
      return;
    }
    settleTo(det.full);
  };

  return (
    <div className="lg:hidden fixed inset-0 z-50 overflow-hidden" role="dialog" aria-modal="true">
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
          {/* Drag handle — the grab zone for the spring drag. Closing is the
              MorphTabBar's ✕ (plus drag-down / backdrop / Escape). */}
          <div
            className="flex shrink-0 cursor-grab items-center justify-center pb-2 pt-3 active:cursor-grabbing"
            style={{ touchAction: "none" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <div className="h-1 w-10 rounded-full bg-zinc-600" />
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
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-2 pb-24">{children}</div>
        </div>
      </div>
    </div>
  );
}
