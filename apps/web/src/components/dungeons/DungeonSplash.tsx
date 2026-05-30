"use client";

import { useEffect, useRef } from "react";
import { createAnimatable, createTimeline, svg, utils } from "animejs";
import { dungeonSplashPath, dungeonAccent } from "@/lib/dungeons/splash";
import { useAnimeScope } from "@/lib/hooks/useAnimeScope";
import { useReducedMotion } from "@/lib/hooks/useReducedMotion";
import { BLOOM, DUR } from "@/lib/motion/tokens";

interface DungeonSplashProps {
  dungeonId: number;
  boss?: boolean;
  /** Headline overlaid on the art (dungeon name, "Boss" reveal, etc). */
  title?: string;
  /** Small uppercase label below the title (theme, depth, etc). */
  subtitle?: string;
}

// Atmospheric splash banner for a dungeon. Renders the base or boss art
// keyed off `dungeonId`, framed by the dungeon's accent ring. Returns
// null when the id has no art so callers can drop it cleanly.
//
// The boss reveal cinematic: the art settles 1.08 to 1.0 (outExpo, camera
// settling), a thin accent ward ring self-draws around the frame, the title
// springs up and the subtitle trails 120ms. Boss splashes keep a slow ward
// breathe; desktop pointer parallax floats the art on a reused createAnimatable.
// Keyed on [src, boss] so it replays only when the splash identity changes, not
// on the run view's frequent re-renders.
export function DungeonSplash({ dungeonId, boss = false, title, subtitle }: DungeonSplashProps) {
  const src = dungeonSplashPath(dungeonId, boss);
  const accent = dungeonAccent(dungeonId) ?? undefined;
  const reduce = useReducedMotion();

  const rootRef = useRef<HTMLDivElement | null>(null);
  const artRef = useRef<HTMLDivElement | null>(null);
  const ringRef = useRef<SVGRectElement | null>(null);
  const titleRef = useRef<HTMLDivElement | null>(null);
  const subtitleRef = useRef<HTMLDivElement | null>(null);

  // Reveal cinematic, scoped + torn down on src/boss change or unmount. This is
  // an entrance animation whose final state equals the resting CSS, so the
  // default scope.revert() teardown is correct.
  useAnimeScope(
    {
      root: rootRef,
      mediaQueries: { reduce: "(prefers-reduced-motion: reduce)" },
      deps: [src, boss],
    },
    ({ reduce: reduced, scope }) => {
      if (!src) return;

      const art = artRef.current;
      const ring = ringRef.current;
      const heading = titleRef.current;
      const sub = subtitleRef.current;

      // Reduced motion: snap everything to its resting frame, skip choreography.
      // The ring is left as its native (fully stroked) rect; we only reveal it.
      if (reduced) {
        if (art) utils.set(art, { scale: 1, opacity: 1 });
        if (ring) utils.set(ring, { opacity: 1 });
        if (heading) utils.set(heading, { opacity: 1, y: 0 });
        if (sub) utils.set(sub, { opacity: 1, y: 0 });
        return;
      }

      // Pin captions hidden before the timeline plays so they never flash their
      // resting (visible) frame for a tick (they render visible for SSR / reduce).
      if (heading) utils.set(heading, { opacity: 0 });
      if (sub) utils.set(sub, { opacity: 0 });

      const tl = createTimeline({ defaults: { ease: "outExpo" } });

      // 1. Art settles in like a camera coming to rest.
      if (art) {
        tl.add(art, { scale: [1.08, 1], opacity: [0, 1], duration: DUR.slow }, 0);
      }

      // 2. The ward ring self-draws around the frame. fill:none, no
      //    non-scaling-stroke so the counter-scale never fights it.
      if (ring) {
        // Init the drawable undrawn (start === end === 0) so making it opaque
        // never flashes a full ring before the etch begins.
        const [drawable] = svg.createDrawable(ring, 0, 0);
        utils.set(ring, { opacity: 1 });
        // Overlap the etch with the art settle so the reveal reads as one gesture.
        tl.add(drawable, { draw: ["0 0", "0 1"], duration: DUR.base, ease: "inOutQuad" }, 220);

        // Boss splashes keep a slow ward breathe after it draws. Ambient loop, so
        // it lives only when motion is allowed and only on boss reveals.
        if (boss) {
          scope.add(() => {
            createTimeline({ loop: true, alternate: true }).add(
              ring,
              { opacity: [0.55, 1], duration: 1600, ease: "inOutSine" },
              0,
            );
          });
        }
      }

      // 3. Title springs up, subtitle trails 120ms.
      if (heading) {
        tl.add(heading, { opacity: [0, 1], y: [12, 0], ease: BLOOM }, "<<+=120");
      }
      if (sub) {
        tl.add(sub, { opacity: [0, 1], y: [8, 0], duration: DUR.base }, "<<+=120");
      }
    },
  );

  // Desktop pointer parallax: one reused createAnimatable floats the art toward
  // the cursor. Skipped under reduced motion and on coarse (touch) pointers.
  // Kept out of the reveal scope so its pointer listener + animatable tear down
  // explicitly here. Only meaningful on boss splashes.
  useEffect(() => {
    const root = rootRef.current;
    const art = artRef.current;
    if (!src || !boss || !root || !art) return;
    if (reduce) return;
    if (typeof window === "undefined") return;
    if (!window.matchMedia("(pointer: fine)").matches) return;

    // Per-channel smoothing on the parallax float. The number after each
    // property is that channel's settle duration; top-level ease applies to both.
    const floater = createAnimatable(art, {
      x: 600,
      y: 600,
      ease: "outQuad",
    });

    const onMove = (e: PointerEvent) => {
      const rect = root.getBoundingClientRect();
      // -1..1 from frame centre, scaled to a small parallax travel.
      const nx = utils.clamp(((e.clientX - rect.left) / rect.width) * 2 - 1, -1, 1);
      const ny = utils.clamp(((e.clientY - rect.top) / rect.height) * 2 - 1, -1, 1);
      floater.x(nx * 8);
      floater.y(ny * 6);
    };
    const onLeave = () => {
      floater.x(0);
      floater.y(0);
    };

    root.addEventListener("pointermove", onMove);
    root.addEventListener("pointerleave", onLeave);
    return () => {
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerleave", onLeave);
      floater.revert();
    };
  }, [src, boss, reduce]);

  if (!src) return null;

  return (
    <div
      ref={rootRef}
      className="relative aspect-[16/9] w-full overflow-hidden rounded-lg border"
      style={{ borderColor: accent ? `${accent}66` : undefined }}
    >
      {/* Art lives on its own layer so the settle-scale + pointer parallax can
          ride transforms without disturbing the ring overlay or captions. */}
      <div
        ref={artRef}
        className="absolute inset-0"
        style={{
          backgroundImage: `url(${src})`,
          backgroundSize: "cover",
          backgroundPosition: "center 35%",
          opacity: 0,
        }}
      />

      {accent && (
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox="0 0 100 56.25"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <rect
            ref={ringRef}
            x="1"
            y="1"
            width="98"
            height="54.25"
            rx="2"
            fill="none"
            stroke={accent}
            strokeWidth="0.6"
            opacity="0"
          />
        </svg>
      )}

      {(title || subtitle) && (
        <div className="absolute inset-x-0 bottom-0 p-4">
          {title && (
            <div
              ref={titleRef}
              className="text-base font-semibold text-zinc-50 [text-shadow:0_1px_2px_rgba(0,0,0,0.95),0_2px_10px_rgba(0,0,0,0.85)]"
            >
              {title}
            </div>
          )}
          {subtitle && (
            <div
              ref={subtitleRef}
              className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider [text-shadow:0_1px_3px_rgba(0,0,0,0.95)]"
              style={{ color: accent }}
            >
              {subtitle}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
