"use client";

import { animate, onScroll, stagger, svg, utils } from "animejs";
import { ChevronRight } from "lucide-react";
import { useEffect, useRef } from "react";
import { useAct } from "@/lib/hooks/useAct";
import { useAnimeScope } from "@/lib/hooks/useAnimeScope";
import { useEstate } from "@/lib/hooks/useEstate";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useReducedMotion } from "@/lib/hooks/useReducedMotion";
import { DUR, EASE, SETTLE, STAGGER } from "@/lib/motion/tokens";
import {
  type Act,
  ACTS,
  beatsDone,
  buildChronicleFacts,
  JOURNEY_BEATS,
  nextBeat,
} from "@/lib/narrative";
import { cn } from "@/lib/utils";

/**
 * The three chapters the climb passes through, in the Cairn's reckoning: the
 * six acts read coarsely against the land. Carried over from the old
 * ChapterBand, which this panel replaces.
 */
const CHAPTERS: Record<Act, { name: string; standing: string }> = {
  0: { name: "Foundation", standing: "The ground is yours. The holding has not begun." },
  1: { name: "Foundation", standing: "The first walls rise. This is where a holding is made." },
  2: { name: "Expansion", standing: "The road has noticed. The land reaches past one claim." },
  3: { name: "Expansion", standing: "A House at your back. The holding is a name now." },
  4: { name: "Mastery", standing: "The realm has learned to say it. The climb is steep here." },
  5: { name: "Mastery", standing: "A crown, and a court of your own. The land answered." },
};

/**
 * The Chronicle: the journey, tracked. Opened from the Cairn (the climb's
 * narrator) into the RightPanel. Current-act focus: the act underway shows its
 * beats in full; the acts behind and ahead fold to a single line each, so the
 * panel reads as "where I am" rather than a wall of every beat.
 *
 * Motion (ANIMEJS_MOTION_OPPORTUNITIES.md 4.5 / 4.6): the current act's beats
 * unfold on a stagger; the chapter bar fills on a spring whose numeric counter
 * is tweened off the SAME object so the bar and number cannot desync; a gold
 * seal stamps via svg.createDrawable on the done-flag edge (diffed against the
 * prior done set so it never replays on a chain poll, and bound to the current
 * act); and the whole climb binds to onScroll({ sync }) so scrolling the
 * history scrubs the timeline forward and reverses on scroll-up.
 */
export function ChroniclePanel() {
  const { data: playerData } = usePlayer();
  const { data: estateData } = useEstate();
  const { act, ownsCastle } = useAct();
  const reduce = useReducedMotion();

  const facts = buildChronicleFacts(playerData?.account, estateData?.account, ownsCastle);
  const done = beatsDone(facts);
  const next = nextBeat(facts);
  const total = JOURNEY_BEATS.length;
  const doneCount = done.size;
  const chapter = CHAPTERS[Math.max(0, Math.min(5, act)) as Act];
  const pct = total > 0 ? (doneCount / total) * 100 : 0;

  // The panel root (scope for the stagger + seal queries), the scroll surface
  // we scrub against, the bar + its numeric counter (one object drives both),
  // and the seal-stamp edge detector.
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);
  const climbRef = useRef<HTMLDivElement>(null);
  const prevDoneRef = useRef<Set<string> | null>(null);
  // Remember the last count the bar animated to so a re-mount or a backward
  // step springs from where the bar actually was, not from zero.
  const prevCountRef = useRef(doneCount);

  // Chapter bar fill + numeric counter, tweened off ONE object so the bar width
  // and the "{doneCount}/{total}" readout share a single spring and cannot
  // desync. Keyed on the done count so it re-runs only when a beat actually
  // completes, not on every chain poll. Under reduced motion, snap both to final.
  // biome-ignore lint/correctness/useExhaustiveDependencies: total/pct are pure functions of doneCount; intentionally keyed on the count edge only.
  useEffect(() => {
    const bar = barRef.current;
    const counter = countRef.current;
    if (!bar || !counter) return;
    if (reduce) {
      bar.style.width = `${pct}%`;
      counter.textContent = `${doneCount}/${total}`;
      return;
    }
    // The shared state object: progress in beat-count units. Both the bar width
    // and the counter text read from it each frame so they advance in lockstep.
    const state = { p: prevCountRef.current };
    const anim = animate(state, {
      p: doneCount,
      ease: SETTLE,
      onUpdate: () => {
        // Bar reads the raw spring value so it glides; the counter rounds the
        // SAME object so the number and the fill cannot tell different stories.
        const frac = total > 0 ? state.p / total : 0;
        bar.style.width = `${frac * 100}%`;
        counter.textContent = `${Math.round(state.p)}/${total}`;
      },
    });
    prevCountRef.current = doneCount;
    return () => {
      anim.cancel();
    };
  }, [doneCount, reduce]);

  // Beats of the current act unfold on a stagger; entrance choreography only.
  // Re-runs when the act changes or the done set shifts. Under reduced motion
  // the scope's reduce flag short-circuits to a direct final-state set.
  useAnimeScope({ root: rootRef, deps: [act, doneCount] }, ({ reduce: r }) => {
    // Query through this panel's own root so sibling surfaces are never swept in
    // (none carry [data-beat] today, but keep it honest).
    const root = rootRef.current;
    if (!root) return;
    const beats = Array.from(root.querySelectorAll<HTMLElement>("[data-beat]"));
    if (beats.length === 0) return;
    if (r) {
      utils.set(beats, { opacity: 1, translateY: 0 });
      return;
    }
    utils.set(beats, { opacity: 0, translateY: 8 });
    animate(beats, {
      opacity: [0, 1],
      translateY: [8, 0],
      duration: DUR.base,
      ease: EASE.out,
      delay: stagger(STAGGER.base),
    });
  });

  // Gold seal stamps on the done-flag EDGE. We diff against the previous done
  // set so a seal draws exactly once, the moment a beat flips to done, and never
  // replays on the next chain poll. Seal drawables are mounted only for the
  // current act's beats (see render), so the cost is bounded to what is on screen.
  useEffect(() => {
    const prev = prevDoneRef.current;
    // First settle: record the baseline without stamping already-done beats
    // (they were done before this mount, so there is no edge to celebrate).
    if (prev === null) {
      prevDoneRef.current = new Set(done);
      return;
    }
    const newlyDone: string[] = [];
    for (const key of done) {
      if (!prev.has(key)) newlyDone.push(key);
    }
    prevDoneRef.current = new Set(done);
    if (newlyDone.length === 0) return;

    for (const key of newlyDone) {
      const selector = `[data-seal="${key}"]`;
      const el = rootRef.current?.querySelector<SVGElement>(selector);
      if (!el) continue;
      const drawn = svg.createDrawable(`${selector} path`);
      if (drawn.length === 0) continue;
      if (reduce) {
        // Snap the seal fully drawn, no stamp choreography.
        utils.set(drawn, { draw: "0 1" });
        utils.set(el, { opacity: 1, scale: 1, rotate: 0 });
        continue;
      }
      utils.set(el, { opacity: 1 });
      utils.set(drawn, { draw: "0 0" });
      // The stroke etches itself shut like a wax seal being pressed.
      animate(drawn, {
        draw: ["0 0", "0 1"],
        duration: DUR.slow,
        ease: EASE.drama,
      });
      // A brief stamp punch on the seal mark as the stroke lands.
      animate(el, {
        scale: [0.7, 1.12, 1],
        rotate: [-14, 0],
        duration: DUR.base,
        ease: EASE.out,
      });
    }
  }, [done, reduce]);

  // High-ceiling pass (4.6): bind the climb to onScroll({ sync }) so scrolling
  // the history scrubs the timeline. Banners unfurl, counts tick, and seals draw
  // as the content advances; scrolling up reverses the same motion. sync ties the
  // animation's progress to the scroll position rather than to time. Skipped
  // under reduced motion (no scrub; content rests at its final state).
  // biome-ignore lint/correctness/useExhaustiveDependencies: act/doneCount change the rendered [data-saga-row] set + content, so we must rebind onScroll to the fresh DOM; they are load-bearing here, not extra.
  useEffect(() => {
    if (reduce) return;
    const container = scrollRef.current;
    const climb = climbRef.current;
    if (!container || !climb) return;
    const rows = Array.from(climb.querySelectorAll<HTMLElement>("[data-saga-row]"));
    if (rows.length === 0) return;

    // Only scrub when there is actually a scroll to scrub. A short history that
    // fits the panel has no scroll position to bind to, so binding onScroll there
    // would strand the lower bands dimmed. Rest them at full state instead.
    if (container.scrollHeight <= container.clientHeight) {
      utils.set(rows, { opacity: 1, translateY: 0 });
      return;
    }

    // Each row unfurls across its own slice of the scroll, so the saga reveals
    // band by band as you travel down the history and folds back as you climb up.
    const anims = rows.map((row) => {
      utils.set(row, { opacity: 0.18, translateY: 10 });
      return animate(row, {
        opacity: [0.18, 1],
        translateY: [10, 0],
        ease: EASE.inOut,
        autoplay: onScroll({
          container,
          target: row,
          sync: 1,
          enter: "bottom-=10% top",
          leave: "top+=20% bottom",
        }),
      });
    });

    return () => {
      for (const a of anims) a.revert();
    };
  }, [reduce, act, doneCount]);

  return (
    <div ref={rootRef} className="space-y-4">
      {/* Chapter: where the land stands on the climb */}
      <div>
        <div className="flex items-baseline gap-2">
          <span className="tier-title font-display text-base font-bold tracking-wide">
            {chapter.name}
          </span>
          <span ref={countRef} className="font-mono text-[10px] tabular-nums text-text-muted">
            {doneCount}/{total}
          </span>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-text-secondary">{chapter.standing}</p>
        <div className="mt-2 h-0.5 w-full overflow-hidden rounded-full bg-surface-overlay">
          <div
            ref={barRef}
            className="h-full rounded-full"
            style={{
              width: `${pct}%`,
              background: "linear-gradient(90deg, var(--nm-accent), var(--nm-accent-bright))",
            }}
          />
        </div>
      </div>

      {/* The climb: the act underway in full, the rest folded to a line. The
          scroll container is the scrub surface the saga binds to. */}
      <div
        ref={scrollRef}
        className="max-h-[60vh] space-y-2 overflow-y-auto border-t border-border-default pt-3"
      >
        <div ref={climbRef} className="space-y-2">
          {ACTS.map((a) => {
            const beats = JOURNEY_BEATS.filter((b) => b.act === a.id);
            if (beats.length === 0) return null;
            const doneInAct = beats.filter((b) => done.has(b.key)).length;

            // Acts behind and ahead fold to one muted line.
            if (a.id !== act) {
              const past = a.id < act;
              const allDone = doneInAct === beats.length;
              return (
                <div
                  key={a.id}
                  data-saga-row
                  className={cn(
                    "flex items-baseline justify-between gap-2 text-xs",
                    !past && "opacity-50",
                  )}
                >
                  <span className="flex items-center gap-1.5 text-text-muted">
                    <span className="w-3 text-center">{past && allDone ? "✦" : "·"}</span>
                    <span>{a.name}</span>
                  </span>
                  <span className="font-mono text-[10px] tabular-nums text-text-muted">
                    {doneInAct}/{beats.length}
                  </span>
                </div>
              );
            }

            // The current act: its beats in full, the next one framed.
            return (
              <div key={a.id} data-saga-row>
                <div className="flex items-baseline gap-2">
                  <span className="tier-title font-display text-sm font-bold tracking-wide">
                    {a.name}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider text-text-muted">
                    Age of {a.age}
                  </span>
                </div>
                <ul className="mt-1.5 space-y-1.5">
                  {beats.map((b) => {
                    const isDone = done.has(b.key);
                    const isNext = next?.key === b.key;
                    return (
                      <li key={b.key} data-beat className="flex gap-2 text-xs">
                        <span
                          className={cn(
                            "relative inline-flex w-3 shrink-0 items-center justify-center",
                            isDone
                              ? "text-text-gold"
                              : isNext
                                ? "text-text-secondary"
                                : "text-text-muted",
                          )}
                        >
                          {isDone ? (
                            // The gold seal: a self-drawing stroked ring + tick
                            // the seal stamp etches onto the done edge.
                            <svg
                              data-seal={b.key}
                              viewBox="0 0 24 24"
                              className="h-3 w-3 text-text-gold"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={2}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                            >
                              <circle cx="12" cy="12" r="9" />
                              <path d="M8.5 12.5l2.5 2.5 4.5-5" />
                            </svg>
                          ) : isNext ? (
                            <ChevronRight className="h-3 w-3" />
                          ) : (
                            "·"
                          )}
                        </span>
                        <div className="min-w-0">
                          <div
                            className={cn(
                              isDone
                                ? "text-text-muted line-through"
                                : isNext
                                  ? "text-text-primary"
                                  : "text-text-muted",
                            )}
                          >
                            {b.label}
                          </div>
                          {isNext && (
                            <div className="mt-0.5 leading-relaxed text-text-secondary">
                              {b.framing}
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
