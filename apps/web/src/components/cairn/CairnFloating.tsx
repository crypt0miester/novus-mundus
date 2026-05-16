"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import anime from "animejs/lib/anime.es.js";
import { CairnOrb } from "./CairnOrb";
import { CairnReport } from "./CairnReport";
import { useAct } from "@/lib/hooks/useAct";
import { throughLine } from "@/lib/narrative";

const ORB = 56;
const EDGE = 12;
const BOTTOM_NAV = 76; // keep the orb clear of the mobile bottom nav
const TAP_MAX = 6; // pointer travel under this many px counts as a tap, not a drag
const POS_KEY = "nm-cairn-pos";

interface Pos {
  x: number;
  y: number;
}

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function clampPos(p: Pos): Pos {
  const maxX = Math.max(EDGE, window.innerWidth - ORB - EDGE);
  const maxY = Math.max(EDGE, window.innerHeight - ORB - BOTTOM_NAV);
  return {
    x: Math.min(Math.max(p.x, EDGE), maxX),
    y: Math.min(Math.max(p.y, EDGE), maxY),
  };
}

function loadPos(): Pos {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Pos;
      if (Number.isFinite(p.x) && Number.isFinite(p.y)) return clampPos(p);
    }
  } catch {
    /* fall through to the default corner */
  }
  return clampPos({
    x: window.innerWidth - ORB - EDGE,
    y: window.innerHeight - ORB - BOTTOM_NAV,
  });
}

/**
 * The Cairn on mobile — a draggable stone. A tap opens its voice: the
 * through-line and the Report, in a popover anchored to wherever the orb has
 * been set down. The drag is pointer-driven (1:1 with the finger); the
 * flourishes — the orb settling in, the tap, the popover open/close — are
 * anime.js. PLAYER_JOURNEY_GAMEPLAN.md §4.
 */
export function CairnFloating() {
  const { act, mood, actDef, hasPlayer } = useAct();
  const line = throughLine("place", act, mood);

  const [pos, setPos] = useState<Pos | null>(null);
  const [mounted, setMounted] = useState(false); // is the popover in the DOM
  const drag = useRef<{
    sx: number;
    sy: number;
    ox: number;
    oy: number;
    moved: number;
  } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const popAnim = useRef<ReturnType<typeof anime> | null>(null);
  const entered = useRef(false);
  const closing = useRef(false);

  // Animate the popover out, then drop it from the DOM.
  const closePopover = useCallback(() => {
    if (closing.current) return;
    if (reducedMotion() || !popRef.current) {
      setMounted(false);
      return;
    }
    closing.current = true;
    popAnim.current?.pause();
    popAnim.current = anime({
      targets: popRef.current,
      opacity: 0,
      scale: 0.9,
      duration: 150,
      easing: "easeInQuad",
      complete: () => {
        closing.current = false;
        setMounted(false);
      },
    });
  }, []);

  // The orb's position depends on the viewport — resolve it after mount.
  useEffect(() => {
    setPos(loadPos());
  }, []);

  useEffect(() => {
    const reclamp = () => setPos((p) => (p ? clampPos(p) : p));
    window.addEventListener("resize", reclamp);
    return () => window.removeEventListener("resize", reclamp);
  }, []);

  // The orb settles into place the first time it appears.
  useEffect(() => {
    if (!pos || entered.current || !btnRef.current) return;
    entered.current = true;
    if (reducedMotion()) {
      btnRef.current.style.opacity = "1";
      return;
    }
    anime({
      targets: btnRef.current,
      opacity: [0, 1],
      scale: [0.4, 1],
      duration: 480,
      easing: "easeOutBack",
    });
  }, [pos]);

  // The popover grows out of the orb's corner when it opens.
  useEffect(() => {
    if (!mounted || !popRef.current) return;
    closing.current = false;
    if (reducedMotion()) {
      popRef.current.style.opacity = "1";
      return;
    }
    popAnim.current?.pause();
    popAnim.current = anime({
      targets: popRef.current,
      opacity: [0, 1],
      scale: [0.9, 1],
      duration: 240,
      easing: "easeOutQuad",
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

  useEffect(() => () => popAnim.current?.pause(), []);

  if (!hasPlayer || !pos) return null;

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y, moved: 0 };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    d.moved = Math.max(d.moved, Math.hypot(e.clientX - d.sx, e.clientY - d.sy));
    setPos(clampPos({ x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) }));
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved < TAP_MAX) {
      if (!reducedMotion() && btnRef.current) {
        anime({
          targets: btnRef.current,
          scale: [
            { value: 0.85, duration: 100 },
            { value: 1, duration: 300 },
          ],
          easing: "easeOutBack",
        });
      }
      if (mounted) closePopover();
      else setMounted(true);
      return;
    }
    try {
      localStorage.setItem(POS_KEY, JSON.stringify(pos));
    } catch {
      /* the position just won't persist */
    }
  };

  // Anchor the popover to the orb's near corner so it always opens on-screen,
  // and let it scale out of the corner that touches the orb.
  const onRight = pos.x + ORB / 2 > window.innerWidth / 2;
  const onBottom = pos.y + ORB / 2 > window.innerHeight / 2;
  const popStyle: React.CSSProperties = {
    position: "fixed",
    maxWidth: "min(288px, calc(100vw - 24px))",
    transformOrigin: `${onBottom ? "bottom" : "top"} ${onRight ? "right" : "left"}`,
  };
  if (onRight) popStyle.right = window.innerWidth - pos.x - ORB;
  else popStyle.left = pos.x;
  if (onBottom) popStyle.bottom = window.innerHeight - pos.y + 8;
  else popStyle.top = pos.y + ORB + 8;

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
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          drag.current = null;
        }}
        style={{ left: pos.x, top: pos.y, touchAction: "none" }}
        className="fixed z-50 cursor-grab rounded-full border-0 bg-transparent p-0 opacity-0 active:cursor-grabbing"
      >
        <CairnOrb mood={mood} act={act} size={ORB} />
      </button>

      {mounted && (
        <div
          ref={popRef}
          role="dialog"
          aria-label="The Cairn"
          style={popStyle}
          className="z-50 flex max-h-[70vh] flex-col gap-2 overflow-y-auto rounded-xl border border-border-default bg-surface-raised p-3 opacity-0 shadow-xl shadow-black/40"
        >
          <div>
            <p className="text-sm leading-snug text-text-secondary">{line}</p>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
              {actDef.name}
            </p>
          </div>
          <CairnReport />
        </div>
      )}
    </>
  );
}
