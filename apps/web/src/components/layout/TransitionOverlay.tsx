"use client";

import { useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createTimeline, svg, eases, utils, type DrawableSVGGeometry } from "animejs";
import { useTransitionStore } from "@/lib/store/transition";
import { useAnimeScope } from "@/lib/hooks/useAnimeScope";
import { BootRing } from "@/components/loading/BootRing";

const ENTER_MS = 340;
const HOLD_MS = 550;
// Act beats carry a sentence to read, not a wipe to glance at, so they linger.
const ACT_BEAT_HOLD_MS = 1600;
const EXIT_MS = 340;

// The drawable seam stretches across most of the viewport width; the SVG view
// box is a flat unit-height strip so the single horizontal line owns the full
// 0..1000 coordinate span and createDrawable can etch it edge to edge.
const SEAM_WIDTH = 1000;

export function TransitionOverlay() {
  const router = useRouter();
  const phase = useTransitionStore((s) => s.phase);
  const kind = useTransitionStore((s) => s.kind);
  const message = useTransitionStore((s) => s.message);
  const actName = useTransitionStore((s) => s.actName);
  const destination = useTransitionStore((s) => s.destination);
  const advance = useTransitionStore((s) => s.advance);
  const reset = useTransitionStore((s) => s.reset);

  const isActBeat = kind === "act-beat";

  const overlayRef = useRef<HTMLDivElement>(null);
  const eyebrowRef = useRef<HTMLParagraphElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const subtitleRef = useRef<HTMLParagraphElement>(null);
  const lineTopRef = useRef<SVGLineElement>(null);
  const lineBotRef = useRef<SVGLineElement>(null);

  // The createDrawable proxies are built lazily off the live <line> refs and
  // reused across phases so the etch-in and retract animate the same geometry.
  const drawablesRef = useRef<DrawableSVGGeometry[] | null>(null);

  const getDrawables = useCallback((): DrawableSVGGeometry[] | null => {
    if (drawablesRef.current) return drawablesRef.current;
    const lineTop = lineTopRef.current;
    const lineBot = lineBotRef.current;
    if (!lineTop || !lineBot) return null;
    drawablesRef.current = [
      svg.createDrawable(lineTop)[0],
      svg.createDrawable(lineBot)[0],
    ];
    return drawablesRef.current;
  }, []);

  const runEnter = useCallback(
    (reduce: boolean) => {
      const overlay = overlayRef.current;
      const eyebrow = eyebrowRef.current;
      const title = titleRef.current;
      const subtitle = subtitleRef.current;
      const drawables = getDrawables();
      if (!overlay || !title || !drawables) return;

      // Flicker-free first frame: stamp the hidden start state before paint.
      overlay.style.display = "flex";
      utils.set(overlay, { opacity: 0 });
      utils.set(title, { opacity: 0 });
      if (subtitle) utils.set(subtitle, { opacity: 0 });
      if (eyebrow) utils.set(eyebrow, { opacity: 0 });
      // "0 0" leaves the stroke fully retracted; the seam etches toward "0 1".
      utils.set(drawables, { draw: "0 0" });

      if (reduce) {
        // No choreography under reduced motion: snap to the resting visible
        // state and hand off so navigation still proceeds on the timer.
        utils.set(overlay, { opacity: 1 });
        utils.set(title, { opacity: 1, y: 0 });
        if (subtitle) utils.set(subtitle, { opacity: 0.7 });
        if (eyebrow) utils.set(eyebrow, { opacity: 1, y: 0 });
        utils.set(drawables, { draw: "0 1" });
        advance("holding");
        return;
      }

      const tl = createTimeline({ defaults: { ease: eases.outQuad } });

      tl.add(overlay, {
        opacity: [0, 1],
        duration: ENTER_MS * 0.6,
      })
        .add(
          drawables,
          {
            draw: ["0 0", "0 1"],
            duration: ENTER_MS,
          },
          0,
        )
        .add(
          title,
          {
            opacity: [0, 1],
            y: [8, 0],
            duration: ENTER_MS * 0.7,
          },
          ENTER_MS * 0.3,
        );

      if (subtitle) {
        tl.add(
          subtitle,
          {
            opacity: [0, 0.7],
            duration: ENTER_MS * 0.6,
          },
          ENTER_MS * 0.5,
        );
      }

      if (eyebrow) {
        tl.add(
          eyebrow,
          {
            opacity: [0, 1],
            y: [6, 0],
            duration: ENTER_MS * 0.6,
          },
          ENTER_MS * 0.2,
        );
      }

      tl.then(() => advance("holding"));
    },
    [advance, getDrawables],
  );

  const runHold = useCallback(() => {
    if (destination) {
      router.push(destination);
    }
    const id = setTimeout(() => advance("exiting"), isActBeat ? ACT_BEAT_HOLD_MS : HOLD_MS);
    return () => clearTimeout(id);
  }, [destination, router, advance, isActBeat]);

  const runExit = useCallback(
    (reduce: boolean) => {
      const overlay = overlayRef.current;
      const eyebrow = eyebrowRef.current;
      const title = titleRef.current;
      const subtitle = subtitleRef.current;
      const drawables = getDrawables();
      if (!overlay || !title || !drawables) return;

      const finish = () => {
        if (overlay) overlay.style.display = "none";
        reset();
      };

      if (reduce) {
        const copy = [subtitle, title, eyebrow].filter(Boolean) as HTMLElement[];
        utils.set(copy, { opacity: 0 });
        // Retract the seam to the far end so it reads as drawn-out, not cut.
        utils.set(drawables, { draw: "1 1" });
        utils.set(overlay, { opacity: 0 });
        finish();
        return;
      }

      const tl = createTimeline({ defaults: { ease: eases.inQuad } });

      tl.add([subtitle, title, eyebrow].filter(Boolean) as HTMLElement[], {
        opacity: 0,
        duration: EXIT_MS * 0.5,
      })
        .add(
          drawables,
          {
            // Retract from the leading edge so the stroke withdraws the way it
            // arrived, rather than collapsing both ends at once.
            draw: "1 1",
            duration: EXIT_MS * 0.7,
          },
          EXIT_MS * 0.2,
        )
        .add(
          overlay,
          {
            opacity: 0,
            duration: EXIT_MS * 0.6,
          },
          EXIT_MS * 0.4,
        );

      tl.then(finish);
    },
    [reset, getDrawables],
  );

  // Each phase builds its timeline inside a scope rooted at the overlay so a
  // rapid route toggle that unmounts mid-phase cancels the in-flight timeline
  // (the confirmed leak). revertOnCleanup:false keeps the committed inline
  // styles between phases; the overlay drives its own display/opacity rest
  // state, so a revert-to-origin would wipe the handoff and flash.
  useAnimeScope(
    { root: overlayRef, revertOnCleanup: false, deps: [phase] },
    ({ reduce }) => {
      if (phase === "entering") runEnter(reduce);
      else if (phase === "exiting") runExit(reduce);
    },
  );

  // The hold phase is a chain-truth wait (push + timed advance) with no
  // animation, so it stays outside the scope and just owns its timeout cleanup.
  useEffect(() => {
    if (phase !== "holding") return;
    return runHold();
  }, [phase, runHold]);

  if (phase === "idle") return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[10001] flex flex-col items-center justify-center bg-surface"
      style={{ display: "none", opacity: 0 }}
    >
      {/* Fades in/out via opacity inheritance from the overlay's own timeline. */}
      <BootRing />

      <svg
        className="pointer-events-none absolute left-[10%] right-[10%] top-[38%] z-10 h-px"
        viewBox={`0 0 ${SEAM_WIDTH} 1`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="transition-seam-top" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="transparent" />
            <stop offset="20%" stopColor="#92400e" />
            <stop offset="50%" stopColor="#fbbf24" />
            <stop offset="80%" stopColor="#92400e" />
            <stop offset="100%" stopColor="transparent" />
          </linearGradient>
        </defs>
        <line
          ref={lineTopRef}
          x1="0"
          y1="0.5"
          x2={SEAM_WIDTH}
          y2="0.5"
          stroke="url(#transition-seam-top)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
          style={{ filter: "drop-shadow(0 0 8px rgba(251, 191, 36, 0.3))" }}
        />
      </svg>

      {isActBeat && (
        <p
          ref={eyebrowRef}
          className="tier-title relative z-10 mb-3 font-mono text-xs uppercase tracking-[0.3em]"
          style={{ opacity: 0 }}
        >
          {actName}
        </p>
      )}
      <h1
        ref={titleRef}
        className={
          isActBeat
            ? "relative z-10 max-w-2xl px-6 text-center font-display text-2xl font-semibold leading-snug tracking-wide text-text-primary md:text-3xl"
            : "tier-title relative z-10 font-display text-4xl font-bold tracking-wider md:text-5xl"
        }
        style={{ opacity: 0 }}
      >
        {isActBeat ? message : "NOVUS MUNDUS"}
      </h1>
      {!isActBeat && (
        <p
          ref={subtitleRef}
          className="relative z-10 mt-3 font-mono text-sm tracking-widest text-text-muted"
          style={{ opacity: 0 }}
        >
          {message}
        </p>
      )}

      <svg
        className="pointer-events-none absolute bottom-[38%] left-[10%] right-[10%] z-10 h-px"
        viewBox={`0 0 ${SEAM_WIDTH} 1`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="transition-seam-bot" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="transparent" />
            <stop offset="20%" stopColor="#92400e" />
            <stop offset="50%" stopColor="#fbbf24" />
            <stop offset="80%" stopColor="#92400e" />
            <stop offset="100%" stopColor="transparent" />
          </linearGradient>
        </defs>
        <line
          ref={lineBotRef}
          x1="0"
          y1="0.5"
          x2={SEAM_WIDTH}
          y2="0.5"
          stroke="url(#transition-seam-bot)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
          style={{ filter: "drop-shadow(0 0 8px rgba(251, 191, 36, 0.3))" }}
        />
      </svg>
    </div>
  );
}
