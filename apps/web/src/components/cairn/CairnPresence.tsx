"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { animate, createSpring, createTimeline, stagger } from "animejs";
import { CairnOrb } from "./CairnOrb";
import { useAct } from "@/lib/hooks/useAct";
import { useRightPanelStore } from "@/lib/store/right-panel";
import { throughLine } from "@/lib/narrative";

const ORB = 44;

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The Cairn on the desktop home base — a stone set down at the foot of the
 * left sidebar, the through-line it speaks rising above it like a spoken
 * cloud. PLAYER_JOURNEY_GAMEPLAN.md §4, §6.1.
 *
 * The stone is alive: it breathes at rest, leans toward a hovering cursor,
 * can be hushed with a click, and re-speaks — word by word — whenever the
 * climb moves it to a new line. The mobile counterpart is CairnFloating.
 */
export function CairnPresence() {
  const { act, mood, actDef, hasPlayer } = useAct();
  const line = throughLine("place", act, mood);
  const show = useRightPanelStore((s) => s.show);

  // The line currently painted in the bubble — updated mid-animation so the
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
  const breathAnim = useRef<ReturnType<typeof animate> | null>(null);

  const wordEls = useCallback(
    () =>
      Array.from(
        lineRef.current?.querySelectorAll<HTMLElement>(".cairn-word") ?? [],
      ),
    [],
  );

  // (1) Entrance, then the idle breath. The orb rises, the bubble grows out
  // of its tail corner; once settled the stone breathes on a slow loop.
  useEffect(() => {
    if (!hasPlayer || started.current) return;
    const orb = orbRef.current;
    const bubble = bubbleRef.current;
    if (!orb || !bubble) return;
    started.current = true;

    if (reducedMotion()) {
      orb.style.opacity = "1";
      bubble.style.opacity = "1";
      return;
    }

    createTimeline()
      .add(orb, {
        opacity: [0, 1],
        scale: [0.4, 1],
        duration: 460,
        ease: "outBack",
      })
      .add(
        bubble,
        {
          opacity: [0, 1],
          scale: [0.85, 1],
          duration: 280,
          ease: "outQuad",
        },
        "-=180",
      )
      .then(() => {
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

  // (4) Re-speak — exit half. When the line changes, the current words fly
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

  // (1 + 4) Reveal — words stagger into the bubble. Runs on the entrance
  // (delayed behind the bubble) and after every re-speak swap.
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

  // (2) Hover — the stone leans toward the cursor and a glow blooms.
  const onEnter = () => {
    hovering.current = true;
    if (reducedMotion()) return;
    if (pressRef.current) {
      animate(pressRef.current, {
        scale: 1.09,
        ease: createSpring({ stiffness: 130, damping: 11 }),
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
        ease: createSpring({ stiffness: 130, damping: 14 }),
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

  // (3) Click — a press bounce, then the Chronicle opens in the RightPanel.
  const onClick = () => {
    if (!reducedMotion() && pressRef.current) {
      animate(pressRef.current, {
        scale: [
          { to: 0.86, duration: 90 },
          { to: hovering.current ? 1.09 : 1, duration: 340 },
        ],
        ease: "outBack",
      });
    }
    show("The Chronicle", "chronicle");
  };

  if (!hasPlayer) return null;

  const wordList = displayLine.split(" ");

  return (
    <div className="pointer-events-none fixed bottom-0 left-0 z-40 hidden w-56 flex-col items-start gap-2 p-3 lg:flex">
      {/* The line — a cloud held above the stone. */}
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
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
            {actDef.name}
          </span>
          <button
            type="button"
            onClick={() => show("The Chronicle", "chronicle")}
            className="pointer-events-auto text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted transition-colors hover:text-text-gold"
          >
            the climb →
          </button>
        </div>
        {/* The tail, pointing down at the stone below. */}
        <span
          aria-hidden
          className="absolute -bottom-[5px] left-6 h-2.5 w-2.5 rotate-45 border-b border-r border-border-default bg-surface-raised"
        />
      </div>

      {/* The stone itself — hover, press, and breath. */}
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
