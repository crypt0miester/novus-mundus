"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { animate, spring, createTimeline, stagger, createDraggable, type Draggable } from "animejs";
import { PRESS } from "@/lib/motion/tokens";
import { CairnOrb } from "./CairnOrb";
import { useAct } from "@/lib/hooks/useAct";
import { useCairnNudge } from "@/lib/hooks/useCairnNudge";
import { useRightPanelStore } from "@/lib/store/right-panel";
import { useDrawerOpen } from "@/lib/hooks/useDrawerOpen";
import { throughLine } from "@/lib/narrative";
import { cn } from "@/lib/utils";

const ORB = 44;
const EDGE = 12;
// Desktop drag position (separate from the mobile CairnFloating key), persisted
// so a dragged stone returns to where it was set down on the next collapse.
const DRAG_POS_KEY = "nm-cairn-desk-pos";

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Drag bounds in viewport coords, inset by the orb so it never leaves the edge.
function dragBounds() {
  return {
    maxX: Math.max(EDGE, window.innerWidth - ORB - EDGE),
    maxY: Math.max(EDGE, window.innerHeight - ORB - EDGE),
  };
}

// The stored drag position, clamped to the current viewport; null if unset/bad.
function loadDragPos(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(DRAG_POS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { x?: unknown; y?: unknown };
    if (typeof p.x === "number" && typeof p.y === "number") {
      const { maxX, maxY } = dragBounds();
      return { x: Math.min(Math.max(p.x, EDGE), maxX), y: Math.min(Math.max(p.y, EDGE), maxY) };
    }
  } catch {
    // fall through to null
  }
  return null;
}

/**
 * The Cairn on the desktop home base, a stone set down at the foot of the
 * left column, the through-line it speaks rising above it like a spoken
 * cloud. PLAYER_JOURNEY_GAMEPLAN.md §4, §6.1.
 *
 * It re-anchors with the contextual drawer: when the drawer is open the stone
 * rests at the drawer foot (its bubble fits the drawer width); when the drawer
 * collapses, the bubble is dropped and only the orb remains, perched at the
 * foot just right of the icon rail so it never covers the rail's account area.
 * It sits just past the icon rail (left-16) either way, clear of the resource
 * footer (which the drawer's pb-44 keeps above it) and the content.
 *
 * The stone is alive: it breathes at rest, leans toward a hovering cursor,
 * can be hushed with a click, and re-speaks, word by word, whenever the
 * climb moves it to a new line. The mobile counterpart is CairnFloating.
 */
export function CairnPresence() {
  const { act, mood, actDef, hasPlayer } = useAct();
  const drawerOpen = useDrawerOpen();
  // A one-off nudge (e.g. the L1 stall) takes over the bubble for a window,
  // then dissolves back to the through-line via the same re-speak animation
  // that drives every other line change.
  const nudge = useCairnNudge();
  const line = nudge ?? throughLine("place", act, mood);
  const show = useRightPanelStore((s) => s.show);

  // The line currently painted in the bubble, updated mid-animation so the
  // old words can leave before the new ones arrive.
  const [displayLine, setDisplayLine] = useState(line);

  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const lineRef = useRef<HTMLParagraphElement | null>(null);
  const actRef = useRef<HTMLDivElement | null>(null);
  const orbRef = useRef<HTMLButtonElement | null>(null);
  const glowRef = useRef<HTMLSpanElement | null>(null);
  const pressRef = useRef<HTMLDivElement | null>(null);
  const breathRef = useRef<HTMLDivElement | null>(null);

  const started = useRef(false);
  const revealedOnce = useRef(false);
  const hovering = useRef(false);
  // The entrance effect owns the bubble's first reveal; the drawer-reopen
  // reveal must skip that initial run so it does not double-animate.
  const bubbleRevealInit = useRef(false);
  const breathAnim = useRef<ReturnType<typeof animate> | null>(null);
  const dragRef = useRef<Draggable | null>(null);

  const wordEls = useCallback(
    () => Array.from(lineRef.current?.querySelectorAll<HTMLElement>(".cairn-word") ?? []),
    [],
  );

  // (1) Entrance, then the idle breath. The orb rises, the bubble (when the
  // drawer is open) grows out of its tail corner; once settled the stone
  // breathes on a slow loop. The bubble is optional: when the drawer is
  // collapsed only the orb enters, and the bubble's own reveal effect plays it
  // in later if the drawer reopens.
  useEffect(() => {
    if (!hasPlayer || started.current) return;
    const orb = orbRef.current;
    if (!orb) return;
    const bubble = bubbleRef.current;
    started.current = true;

    if (reducedMotion()) {
      orb.style.opacity = "1";
      if (bubble) bubble.style.opacity = "1";
      return;
    }

    const tl = createTimeline().add(orb, {
      opacity: [0, 1],
      scale: [0.4, 1],
      duration: 460,
      ease: "outBack",
    });
    if (bubble) {
      tl.add(
        bubble,
        {
          opacity: [0, 1],
          scale: [0.85, 1],
          duration: 280,
          ease: "outQuad",
        },
        "-=180",
      );
    }
    tl.then(() => {
      if (!breathRef.current) return;
      breathAnim.current = animate(breathRef.current, {
        scale: [1, 1.045],
        duration: 4200,
        ease: "inOutSine",
        loop: true,
        alternate: true,
      });
    });

    return () => {
      breathAnim.current?.pause();
      breathAnim.current = null;
      started.current = false;
    };
  }, [hasPlayer]);

  // Draggable only while the drawer is collapsed. With the drawer open the stone
  // rests at the drawer foot (anchored, not draggable); collapsed, anime.js'
  // Draggable lets it be moved anywhere and the spot persists. Reverting on
  // reopen clears the transform so it snaps back to the anchor.
  useEffect(() => {
    if (!hasPlayer || drawerOpen) return;
    const orb = orbRef.current;
    if (!orb) return;

    const d = createDraggable(orb, {
      // [top, right, bottom, left]: the viewport, inset by the orb.
      container: () => {
        const { maxX, maxY } = dragBounds();
        return [EDGE, maxX, maxY, EDGE];
      },
      // Share the press spring so the drag-settle matches the tap recoil.
      releaseEase: PRESS,
      dragThreshold: 6, // travel under this stays a tap (opens the Chronicle)
      onSettle: (self) => {
        try {
          localStorage.setItem(DRAG_POS_KEY, JSON.stringify({ x: self.x, y: self.y }));
        } catch {
          // the position just won't persist
        }
      },
    });
    dragRef.current = d;

    const p = loadDragPos();
    if (p) {
      d.setX(p.x);
      d.setY(p.y);
    }

    const onResize = () => {
      d.refresh();
      const { maxX, maxY } = dragBounds();
      d.setX(Math.min(Math.max(d.x, EDGE), maxX));
      d.setY(Math.min(Math.max(d.y, EDGE), maxY));
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      d.revert();
      dragRef.current = null;
    };
  }, [drawerOpen, hasPlayer]);

  // Bubble + words reveal on drawer reopen. The entrance plays the bubble in
  // only when it is mounted at first paint; if the drawer was collapsed then
  // (or reopens later) the bubble remounts with its opacity-0 rest class and
  // its words at opacity-0, so it needs its own play-in or it stays invisible.
  // Skipped on the very first entrance (the entrance timeline owns that); only
  // re-reveals on subsequent mounts.
  useEffect(() => {
    if (!bubbleRevealInit.current) {
      bubbleRevealInit.current = true;
      return;
    }
    if (!drawerOpen || !started.current) return;
    const bubble = bubbleRef.current;
    if (!bubble) return;
    const spans = wordEls();
    if (reducedMotion()) {
      bubble.style.opacity = "1";
      spans.forEach((s) => {
        s.style.opacity = "1";
      });
      return;
    }
    animate(bubble, {
      opacity: [0, 1],
      scale: [0.85, 1],
      duration: 280,
      ease: "outQuad",
    });
    if (spans.length) {
      animate(spans, {
        opacity: [0, 1],
        y: [8, 0],
        duration: 360,
        delay: stagger(26),
        ease: "outQuad",
      });
    }
  }, [drawerOpen, wordEls]);

  // (4) Re-speak, exit half. When the line changes, the current words fly
  // out staggered and the orb pulses (a glow "tell"); then the text swaps.
  useEffect(() => {
    if (line === displayLine) return;
    if (!started.current || reducedMotion()) {
      setDisplayLine(line);
      return;
    }
    if (glowRef.current) {
      animate(glowRef.current, {
        opacity: [
          { to: 0.6, duration: 150 },
          { to: hovering.current ? 0.5 : 0, duration: 420 },
        ],
        ease: "outQuad",
      });
    }
    const spans = wordEls();
    if (!spans.length) {
      setDisplayLine(line);
      return;
    }
    animate(spans, {
      opacity: [1, 0],
      y: [0, -7],
      duration: 150,
      delay: stagger(14),
      ease: "inQuad",
      onComplete: () => setDisplayLine(line),
    });
  }, [line, displayLine, wordEls]);

  // (1 + 4) Reveal: words stagger into the bubble. Runs on the entrance
  // (delayed behind the bubble) and after every re-speak swap. A drawer reopen
  // is handled by the dedicated bubble-reveal effect above.
  useEffect(() => {
    const spans = wordEls();
    if (!spans.length) return;
    const first = !revealedOnce.current;
    revealedOnce.current = true;

    if (reducedMotion()) {
      spans.forEach((s) => (s.style.opacity = "1"));
      return;
    }
    animate(spans, {
      opacity: [0, 1],
      y: [8, 0],
      duration: 360,
      delay: stagger(26, { start: first ? 520 : 0 }),
      ease: "outQuad",
    });
    if (!first && actRef.current) {
      animate(actRef.current, { opacity: [0, 1], duration: 320, ease: "outQuad" });
    }
  }, [displayLine, hasPlayer, wordEls]);

  // (2) Hover: the stone leans toward the cursor and a glow blooms.
  const onEnter = () => {
    hovering.current = true;
    if (reducedMotion()) return;
    if (pressRef.current) {
      animate(pressRef.current, {
        scale: 1.09,
        ease: spring({ stiffness: 130, damping: 11 }),
      });
    }
    if (glowRef.current) {
      animate(glowRef.current, {
        opacity: 0.5,
        scale: 1.7,
        duration: 360,
        ease: "outQuad",
      });
    }
    if (bubbleRef.current) {
      animate(bubbleRef.current, { y: -3, duration: 300, ease: "outQuad" });
    }
  };
  const onLeave = () => {
    hovering.current = false;
    if (reducedMotion()) return;
    if (pressRef.current) {
      animate(pressRef.current, {
        scale: 1,
        ease: spring({ stiffness: 130, damping: 14 }),
      });
    }
    if (glowRef.current) {
      animate(glowRef.current, {
        opacity: 0,
        scale: 1,
        duration: 300,
        ease: "outQuad",
      });
    }
    if (bubbleRef.current) {
      animate(bubbleRef.current, { y: 0, duration: 300, ease: "outQuad" });
    }
  };

  // (3) Click: a single spring recoil, then the Chronicle opens in the
  // RightPanel. The recoil rides composition:"blend" on pressRef while the idle
  // breathe loops on breathRef, so the two never fight: blend layers the squeeze
  // over the resting scale instead of snapping it. Under blend we use a plain
  // [from,to] array (no keyframes), and one PRESS spring replaces the old
  // two-step duration tween so drag-settle and this squeeze share one material.
  const onClick = () => {
    if (!reducedMotion() && pressRef.current) {
      animate(pressRef.current, {
        scale: [0.86, hovering.current ? 1.09 : 1],
        ease: PRESS,
        composition: "blend",
      });
    }
    show("The Chronicle", "chronicle");
  };

  if (!hasPlayer) return null;

  const wordList = displayLine.split(" ");

  return (
    <div
      // Anchored just right of the icon rail (left-16) at the column foot. Open:
      // the full bubble + orb rest over the drawer foot. Collapsed: only the orb
      // shows (the bubble is dropped), perched at the rail foot over the content
      // corner, never covering the rail's account area.
      // Shown from md+ now that the rail + drawer (and its foot) appear there;
      // below md the mobile CairnFloating takes over. At md the drawer defaults
      // collapsed, so the Cairn shows orb-only at the rail foot until pinned open.
      className={cn(
        "pointer-events-none fixed bottom-2 left-16 z-40 hidden flex-col items-start gap-2 p-4 md:flex",
        drawerOpen ? "w-56" : "w-auto",
      )}
    >
      {/* The line: a cloud held above the stone. Dropped when the drawer
          collapses so only the orb remains at the rail foot. */}
      {drawerOpen && (
        <div
          ref={bubbleRef}
          style={{ transformOrigin: "bottom left" }}
          className="relative w-full rounded-2xl rounded-bl-md border border-border-default bg-surface-raised p-3 opacity-0 shadow-xl shadow-black/40"
        >
          <p ref={lineRef} className="text-sm leading-snug text-text-secondary">
            {wordList.map((w, i) => (
              <Fragment key={`${displayLine}-${i}`}>
                <span className="cairn-word inline-block opacity-0">{w}</span>
                {i < wordList.length - 1 ? " " : ""}
              </Fragment>
            ))}
          </p>
          <div ref={actRef} className="mt-1 flex items-center gap-2">
            <span className="text-[10px] font-medium lowercase text-text-muted">{actDef.name}</span>
            <button
              type="button"
              onClick={() => show("The Chronicle", "chronicle")}
              className="pointer-events-auto inline-flex items-center gap-0.5 text-[10px] font-medium lowercase text-text-muted transition-colors hover:text-text-gold"
            >
              the climb
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
          {/* The tail, pointing down at the stone below. */}
          <span
            aria-hidden
            className="absolute -bottom-[5px] left-6 h-2.5 w-2.5 rotate-45 border-b border-r border-border-default bg-surface-raised"
          />
        </div>
      )}

      {/* The stone itself: hover, press, and breath. */}
      <button
        ref={orbRef}
        type="button"
        aria-label="Open the Chronicle"
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        onClick={onClick}
        style={{ width: ORB, height: ORB }}
        className="pointer-events-auto relative cursor-pointer rounded-full border-0 bg-transparent p-0 opacity-0"
      >
        <span
          ref={glowRef}
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full bg-[var(--tier-accent)] opacity-0 blur-md"
        />
        <div ref={pressRef} className="relative">
          <div ref={breathRef}>
            <CairnOrb mood={mood} act={act} size={ORB} />
          </div>
        </div>
      </button>
    </div>
  );
}
