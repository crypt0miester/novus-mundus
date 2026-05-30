"use client";

import { useRef, useEffect, useState } from "react";
import { animate, stagger, utils } from "animejs";
import { useAnimeScope } from "@/lib/hooks/useAnimeScope";
import { DUR, STAGGER, EASE } from "@/lib/motion/tokens";
import { BootRing } from "./BootRing";

interface LoadingStep {
  label: string;
  key: string;
}

interface LoadingSequenceProps {
  steps: readonly LoadingStep[];
  screen?: keyof typeof TIERED;
  completedKeys: Set<string>;
  children: React.ReactNode;
}

export function LoadingSequence({
  steps: initialSteps,
  screen,
  completedKeys,
  children,
}: LoadingSequenceProps) {
  // Upgrade to act-aware labels after hydration (SSR always gets act 0)
  const [steps, setSteps] = useState<readonly LoadingStep[]>(initialSteps);
  useEffect(() => {
    if (screen && TIERED[screen]) {
      setSteps(getTieredSteps(screen, TIERED[screen]));
    }
  }, [screen]);

  const containerRef = useRef<HTMLDivElement>(null);
  const dataDone = steps.every((s) => completedKeys.has(s.key));

  // Hold the boot scene for a minimum interval even when queries resolve
  // instantly from cache. Without this, `LoadingSequence` unmounts inside the
  // same React commit and `BootRing`'s Three.js renderer never gets a frame to
  // paint. The ritual reads as a flash of nothing; the ring is wasted. 900ms is
  // short enough to not annoy on warm caches, long enough for the rings to draw
  // two full breathing cycles.
  const [minHeld, setMinHeld] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setMinHeld(true), 900);
    return () => clearTimeout(id);
  }, []);
  const allDone = dataDone && minHeld;

  // One scoped reveal-and-stamp lifecycle. The scope roots every tween at the
  // boot container so cleanup is a single scope teardown on unmount (the old
  // forEach spawned uncleaned animations). It re-runs on the data signature
  // below so newly-completed steps stamp on their edge; the entrance only ever
  // plays once because already-mounted rows are skipped via `data-entered`, and
  // each `.check` is stamped at most once via `data-stamped`.
  const entryDoneKey = steps.map((s) => s.key).join("|");
  const stampSig = steps.map((s) => (completedKeys.has(s.key) ? "1" : "0")).join("");
  useAnimeScope(
    // Re-runs on the data signature so newly-completed steps stamp on their
    // edge, but cleanup must NOT revert: this lifecycle settles rows and checks
    // to their final inline state, and reverting between generations would strip
    // those committed styles and flash already-entered rows back to opacity 0.
    // Cancel-only teardown leaves the settled state and just kills in-flight
    // tweens, which is also correct for the final unmount (the node is gone).
    { root: containerRef, deps: [entryDoneKey, stampSig, allDone], revertOnCleanup: false },
    ({ reduce }) => {
      const root = containerRef.current;
      if (!root) return;

      // Step rows that have not yet entered. utils.set pins their pre-entrance
      // state on the same frame they mount so there is no flash before the
      // staggered slide-in (the rows ship with `opacity-0`, but the x offset is
      // not expressed in CSS).
      const fresh = Array.from(
        root.querySelectorAll<HTMLDivElement>("[data-step]:not([data-entered])"),
      );
      for (const el of fresh) el.dataset.entered = "1";

      if (fresh.length > 0) {
        if (reduce) {
          // Set the final resting state directly, skip the choreography.
          utils.set(fresh, { x: 0, opacity: 1 });
        } else {
          utils.set(fresh, { x: -20, opacity: 0 });
          animate(fresh, {
            x: [-20, 0],
            opacity: [0, 1],
            delay: stagger(STAGGER.loose),
            duration: DUR.base,
            ease: EASE.inOut,
          });
        }
      }

      // Checkmarks for steps that just reached `done`. Stamp each once on its
      // edge (a step completing adds a `.check` element) via `data-stamped`.
      const checks = Array.from(
        root.querySelectorAll<HTMLSpanElement>(".check:not([data-stamped])"),
      );
      for (const el of checks) el.dataset.stamped = "1";

      if (checks.length > 0) {
        if (reduce) {
          utils.set(checks, { scale: 1, rotate: "0deg" });
        } else {
          animate(checks, {
            scale: [0, 1],
            rotate: ["-45deg", "0deg"],
            delay: stagger(STAGGER.tight),
            duration: DUR.fast,
            ease: "outBack",
          });
        }
      }

      // Reveal: lift and fade the boot scene out once everything has settled.
      if (allDone) {
        if (reduce) {
          utils.set(root, { opacity: 0, y: -20 });
        } else {
          animate(root, {
            opacity: [1, 0],
            y: [0, -20],
            duration: DUR.base,
            ease: EASE.inOut,
          });
        }
      }
    },
  );

  if (allDone) return <>{children}</>;

  return (
    <div
      ref={containerRef}
      className="relative flex mt-10 min-h-[60vh] flex-col items-center justify-center gap-6"
    >
      <BootRing />
      <h2 className="tier-title font-display relative z-10 text-2xl font-semibold tracking-wide">
        NOVUS MUNDUS
      </h2>
      <div className="relative z-10 flex w-80 flex-col gap-3">
        {steps.map((step) => {
          const done = completedKeys.has(step.key);
          return (
            <div
              key={step.key}
              data-step={step.key}
              className="flex items-center gap-3 opacity-0"
            >
              {done ? (
                <span className="check scale-0 tier-accent-text">●</span>
              ) : (
                <span className="animate-pulse text-zinc-600">◌</span>
              )}
              <span className={done ? "text-zinc-400 lowercase" : "text-zinc-500 lowercase"}>
                {step.label}
              </span>
              {done && <span className="ml-auto text-xs text-zinc-600">✓</span>}
            </div>
          );
        })}
      </div>
      <div className="mt-4 h-0.5 w-48 overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-full rounded-full tier-bar"
          style={{
            width: `${(completedKeys.size / steps.length) * 100}%`,
            transition: "width 0.5s ease",
          }}
        />
      </div>
    </div>
  );
}

/**
 * Act-keyed loading step labels. The tone escalates with the player's
 * narrative act, grim at the start of the climb and grand once it is earned.
 * Index maps to the act: [act 0, act 1, act 2, act 3, acts 4-5].
 */
type TieredStep = { key: string; labels: readonly [string, string, string, string, string] };

const TIERED: Record<string, readonly TieredStep[]> = {
  dashboard: [
    {
      key: "player",
      labels: [
        "Loading player data...",
        "Summoning your warrior...",
        "Your knights assemble...",
        "The champion rises...",
        "A legend stirs...",
      ],
    },
    {
      key: "gameEngine",
      labels: [
        "Fetching game state...",
        "Reading the kingdom ledger...",
        "Consulting the royal archives...",
        "The grand council convenes...",
        "Fate itself takes notice...",
      ],
    },
    {
      key: "user",
      labels: [
        "Loading profile...",
        "Scanning your domain...",
        "Surveying the silver realm...",
        "Inspecting the royal court...",
        "Your dominion spans horizons...",
      ],
    },
    {
      key: "loot",
      labels: [
        "Checking rewards...",
        "Checking unclaimed loot...",
        "Tallying the silver spoils...",
        "Counting the royal treasury...",
        "Mythic treasures await...",
      ],
    },
  ],
  city: [
    {
      key: "city",
      labels: [
        "Loading city...",
        "Entering the city gates...",
        "The silver banners welcome you...",
        "The golden streets gleam...",
        "The city kneels before you...",
      ],
    },
    {
      key: "encounters",
      labels: [
        "Loading encounters...",
        "Scouting for encounters...",
        "Knights patrol the streets...",
        "The royal guard reports...",
        "Legends stalk the shadows...",
      ],
    },
    {
      key: "players",
      labels: [
        "Loading players...",
        "Counting heads at the tavern...",
        "The guild hall buzzes...",
        "Nobles gather at court...",
        "Champions fill the halls...",
      ],
    },
  ],
  estate: [
    {
      key: "estate",
      labels: [
        "Loading estate...",
        "Surveying your lands...",
        "Your silver estates shimmer...",
        "The golden manor awaits...",
        "Your mythic fortress looms...",
      ],
    },
    {
      key: "player",
      labels: [
        "Loading buildings...",
        "Inspecting the buildings...",
        "Checking the armory...",
        "The royal workshops hum...",
        "Legendary forges ignite...",
      ],
    },
    {
      key: "gameEngine",
      labels: [
        "Loading schedule...",
        "Checking daily windows...",
        "Reviewing the calendar...",
        "The steward presents reports...",
        "Time bends to your will...",
      ],
    },
  ],
  dungeon: [
    {
      key: "dungeonRun",
      labels: [
        "Loading dungeon...",
        "Descending into darkness...",
        "Silver torches flicker...",
        "The golden depths call...",
        "The abyss whispers your name...",
      ],
    },
    {
      key: "player",
      labels: [
        "Loading hero...",
        "Readying your hero...",
        "Strapping on silver mail...",
        "Donning golden armor...",
        "The mythic blade awakens...",
      ],
    },
    {
      key: "template",
      labels: [
        "Loading layout...",
        "Lighting the torches...",
        "Mapping the corridors...",
        "Scouts report treasure ahead...",
        "Ancient power pulses below...",
      ],
    },
  ],
  arena: [
    {
      key: "season",
      labels: [
        "Loading season...",
        "Entering the colosseum...",
        "The crowd roars...",
        "Champions salute the king...",
        "The arena trembles with awe...",
      ],
    },
    {
      key: "loadout",
      labels: [
        "Loading loadout...",
        "Reviewing your loadout...",
        "Polishing the silver edge...",
        "Sharpening the golden blade...",
        "Your mythic aura blazes...",
      ],
    },
    {
      key: "participant",
      labels: [
        "Loading standings...",
        "Checking the standings...",
        "Rivals sharpen their swords...",
        "The elite prepare for war...",
        "Only legends remain...",
      ],
    },
  ],
  castle: [
    {
      key: "castle",
      labels: [
        "Loading castle...",
        "Approaching the fortress...",
        "Silver towers pierce the sky...",
        "The golden keep gleams...",
        "Your mythic citadel awaits...",
      ],
    },
    {
      key: "garrison",
      labels: [
        "Loading garrison...",
        "Inspecting the garrison...",
        "Knights stand at attention...",
        "The elite guard salutes...",
        "Legendary forces assemble...",
      ],
    },
    {
      key: "court",
      labels: [
        "Loading decrees...",
        "Reading court decrees...",
        "The council is in session...",
        "Royal edicts are proclaimed...",
        "The realm awaits your decree...",
      ],
    },
  ],
  shop: [
    {
      key: "shopConfig",
      labels: [
        "Loading shop...",
        "Browsing the wares...",
        "Fine silver on display...",
        "The royal emporium opens...",
        "Mythic relics surface...",
      ],
    },
    {
      key: "player",
      labels: [
        "Loading balance...",
        "Checking your coin purse...",
        "Counting silver marks...",
        "The golden coffers overflow...",
        "Wealth beyond measure...",
      ],
    },
    {
      key: "flashSales",
      labels: [
        "Loading sales...",
        "Hunting for flash sales...",
        "Rare deals spotted...",
        "Exclusive offers appear...",
        "Once-in-an-age bargains...",
      ],
    },
  ],
  hero: [
    {
      key: "heroes",
      labels: [
        "Loading heroes...",
        "Assembling your champions...",
        "Silver-rank heroes answer...",
        "Golden champions march forth...",
        "Legends answer the call...",
      ],
    },
    {
      key: "player",
      labels: [
        "Loading stats...",
        "Reading their legends...",
        "Reviewing the chronicles...",
        "The royal scribe reports...",
        "Their myths are written in stars...",
      ],
    },
    {
      key: "estate",
      labels: [
        "Loading sanctuary...",
        "Checking the sanctuary...",
        "The shrine hums softly...",
        "Sacred golden light pulses...",
        "The mythic sanctum resonates...",
      ],
    },
  ],
};

import { getCachedAct } from "@/lib/narrative";

/** Get loading steps for a screen. Always returns the act-0 labels to avoid
 *  hydration mismatch. LoadingSequence upgrades to the cached act after mount. */
export function getLoadingSteps(screen: keyof typeof TIERED): LoadingStep[] {
  return TIERED[screen].map((s) => ({ key: s.key, label: s.labels[0] }));
}

/** Resolve act-aware labels (client-only, post-hydration). Acts run 0-5 onto
 *  five label pools; the Crown act (5) shares the top pool with act 4. */
function getTieredSteps(screen: string, steps: readonly TieredStep[]): LoadingStep[] {
  const act = getCachedAct();
  const idx = Math.min(Math.max(act, 0), 4);
  return steps.map((s) => ({ key: s.key, label: s.labels[idx] }));
}

/** Static steps (bronze tier) for backward compatibility */
const LOADING_STEPS = Object.fromEntries(
  Object.entries(TIERED).map(([screen, steps]) => [
    screen,
    steps.map((s) => ({ key: s.key, label: s.labels[1] })),
  ]),
) as Record<keyof typeof TIERED, LoadingStep[]>;
