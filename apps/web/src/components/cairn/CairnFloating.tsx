"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { animate, createDraggable, type Draggable } from "animejs";
import { CairnOrb } from "./CairnOrb";
import { CairnReport } from "./CairnReport";
import { useAct } from "@/lib/hooks/useAct";
import { useRightPanelStore } from "@/lib/store/right-panel";
import { throughLine } from "@/lib/narrative";

const ORB = 44; // the floating stone — small enough to stay out of the way
const EDGE = 12;
const BOTTOM_NAV = 76; // keep the orb clear of the mobile bottom nav
const POS_KEY = "nm-cairn-pos";

interface Pos {
  x: number;
  y: number;
}

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The orb's drag bounds in viewport coordinates — recomputed on resize. */
function bounds() {
  return {
    maxX: Math.max(EDGE, window.innerWidth - ORB - EDGE),
    maxY: Math.max(EDGE, window.innerHeight - ORB - BOTTOM_NAV),
  };
}

/** Where the orb should rest on first paint — a stored corner, or bottom-right. */
function loadPos(): Pos {
  const { maxX, maxY } = bounds();
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Pos;
      if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
        return {
          x: Math.min(Math.max(p.x, EDGE), maxX),
          y: Math.min(Math.max(p.y, EDGE), maxY),
        };
      }
    }
  } catch {
    /* fall through to the default corner */
  }
  return { x: maxX, y: maxY };
}

/**
 * The Cairn on mobile — a draggable stone. anime.js' Draggable owns its
 * position: drag it anywhere and it docks to the nearest screen edge. A tap
 * opens its voice — the through-line and the Report, in a popover anchored to
 * wherever the orb was set down.
 */
export function CairnFloating() {
  const { act, mood, actDef, hasPlayer } = useAct();
  const line = throughLine("place", act, mood);
  const show = useRightPanelStore((s) => s.show);

  const [mounted, setMounted] = useState(false); // is the popover in the DOM
  // The orb's position the moment the popover opened — anchors the popover
  // without pulling every drag frame through React.
  const [popPos, setPopPos] = useState<Pos | null>(null);

  const btnRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Draggable | null>(null);
  const popAnim = useRef<ReturnType<typeof animate> | null>(null);
  const closing = useRef(false);

  // Animate the popover out, then drop it from the DOM. Safe to call when the
  // popover is already closed — Draggable's onGrab fires it on every grab.
  const closePopover = useCallback(() => {
    if (closing.current) return;
    if (reducedMotion() || !popRef.current) {
      setMounted(false);
      return;
    }
    closing.current = true;
    popAnim.current?.pause();
    popAnim.current = animate(popRef.current, {
      opacity: 0,
      scale: 0.9,
      duration: 150,
      ease: "inQuad",
      onComplete: () => {
        closing.current = false;
        setMounted(false);
      },
    });
  }, []);

  // Hand the orb to anime.js Draggable once it has mounted. Draggable owns the
  // drag, the edge snapping, and the release spring; React never sees a frame.
  useEffect(() => {
    if (!hasPlayer || !btnRef.current || dragRef.current) return;
    const btn = btnRef.current;

    const d = createDraggable(btn, {
      // [top, right, bottom, left] — the viewport, inset by the orb and nav.
      container: () => {
        const { maxX, maxY } = bounds();
        return [EDGE, maxX, maxY, EDGE];
      },
      // Dock horizontally to whichever vertical edge is nearer on release.
      x: {
        snap: () => {
          const { maxX } = bounds();
          return [EDGE, maxX];
        },
      },
      y: true,
      dragThreshold: 6, // travel under this stays a tap, not a drag
      onGrab: closePopover, // any grab — drag or tap — dismisses the popover
      onSettle: (self) => {
        try {
          localStorage.setItem(
            POS_KEY,
            JSON.stringify({ x: self.x, y: self.y }),
          );
        } catch {
          /* the position just won't persist */
        }
      },
    });
    dragRef.current = d;

    const p = loadPos();
    d.setX(p.x);
    d.setY(p.y);

    // The orb settles into place the first time it appears.
    if (reducedMotion()) {
      btn.style.opacity = "1";
    } else {
      animate(btn, {
        opacity: [0, 1],
        scale: [0.4, 1],
        duration: 480,
        ease: "outBack",
      });
    }

    return () => {
      d.revert();
      dragRef.current = null;
    };
  }, [hasPlayer, closePopover]);

  // Keep the bounds and snap edges honest when the viewport changes.
  useEffect(() => {
    const onResize = () => {
      const d = dragRef.current;
      if (!d) return;
      d.refresh();
      const { maxX, maxY } = bounds();
      d.setX(Math.min(Math.max(d.x, EDGE), maxX));
      d.setY(Math.min(Math.max(d.y, EDGE), maxY));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // The popover grows out of the orb's corner when it opens.
  useEffect(() => {
    if (!mounted || !popRef.current) return;
    closing.current = false;
    if (reducedMotion()) {
      popRef.current.style.opacity = "1";
      return;
    }
    popAnim.current?.pause();
    popAnim.current = animate(popRef.current, {
      opacity: [0, 1],
      scale: [0.9, 1],
      duration: 240,
      ease: "outQuad",
    });
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePopover();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mounted, closePopover]);

  useEffect(
    () => () => {
      popAnim.current?.pause();
    },
    [],
  );

  if (!hasPlayer) return null;

  // A genuine tap — Draggable suppresses the click after a real drag, and
  // onGrab has already closed the popover, so this only ever needs to open it.
  const onTap = () => {
    if (mounted || closing.current) return;
    const d = dragRef.current;
    setPopPos(d ? { x: d.x, y: d.y } : null);
    if (!reducedMotion() && btnRef.current) {
      animate(btnRef.current, {
        scale: [
          { to: 0.85, duration: 100 },
          { to: 1, duration: 300 },
        ],
        ease: "outBack",
      });
    }
    setMounted(true);
  };

  // Anchor the popover to the orb's near corner so it always opens on-screen,
  // and let it scale out of the corner that touches the orb.
  let popStyle: React.CSSProperties | null = null;
  if (mounted && popPos) {
    const onRight = popPos.x + ORB / 2 > window.innerWidth / 2;
    const onBottom = popPos.y + ORB / 2 > window.innerHeight / 2;
    popStyle = {
      position: "fixed",
      maxWidth: "min(288px, calc(100vw - 24px))",
      transformOrigin: `${onBottom ? "bottom" : "top"} ${onRight ? "right" : "left"}`,
    };
    if (onRight) popStyle.right = window.innerWidth - popPos.x - ORB;
    else popStyle.left = popPos.x;
    if (onBottom) popStyle.bottom = window.innerHeight - popPos.y + 8;
    else popStyle.top = popPos.y + ORB + 8;
  }

  return (
    <>
      {mounted && (
        <div
          aria-hidden
          className="fixed inset-0 z-40"
          onPointerDown={() => closePopover()}
        />
      )}

      <button
        ref={btnRef}
        type="button"
        aria-label="The Cairn"
        aria-expanded={mounted}
        onClick={onTap}
        style={{ left: 0, top: 0 }}
        className="fixed z-50 cursor-grab rounded-full border-0 bg-transparent p-0 opacity-0 active:cursor-grabbing"
      >
        <CairnOrb mood={mood} act={act} size={ORB} />
      </button>

      {mounted && popStyle && (
        <div
          ref={popRef}
          role="dialog"
          aria-label="The Cairn"
          style={popStyle}
          className="z-50 flex max-h-[70vh] flex-col gap-2 overflow-y-auto rounded-xl border border-border-default bg-surface-raised p-3 opacity-0 shadow-xl shadow-black/40"
        >
          <div>
            <p className="text-sm leading-snug text-text-secondary">{line}</p>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                {actDef.name}
              </span>
              <button
                type="button"
                onClick={() => {
                  show("The Chronicle", "chronicle");
                  closePopover();
                }}
                className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted transition-colors hover:text-text-gold"
              >
                the climb →
              </button>
            </div>
          </div>
          <CairnReport />
        </div>
      )}
    </>
  );
}
