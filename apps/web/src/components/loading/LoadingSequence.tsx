"use client";

import { useRef, useEffect, useState } from "react";
import { animate, stagger } from "animejs";

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
  const stepsRef = useRef<(HTMLDivElement | null)[]>([]);
  const allDone = steps.every((s) => completedKeys.has(s.key));

  // Stagger step entrances
  useEffect(() => {
    animate(stepsRef.current.filter(Boolean), {
      x: [-20, 0],
      opacity: [0, 1],
      delay: stagger(120),
      duration: 400,
      ease: "outQuad",
    });
  }, []);

  // Mark steps as complete with checkmark animation
  useEffect(() => {
    stepsRef.current.forEach((el, i) => {
      if (!el) return;
      const step = steps[i];
      if (completedKeys.has(step.key)) {
        const check = el.querySelector(".check");
        if (check) {
          animate(check, {
            scale: [0, 1],
            rotate: ["-45deg", "0deg"],
            duration: 300,
            ease: "outBack",
          });
        }
      }
    });
  }, [completedKeys, steps]);

  // Reveal content when all done
  useEffect(() => {
    if (allDone && containerRef.current) {
      animate(containerRef.current, {
        opacity: [1, 0],
        y: [0, -20],
        duration: 400,
        ease: "inQuad",
      });
    }
  }, [allDone]);

  if (allDone) return <>{children}</>;

  return (
    <div
      ref={containerRef}
      className="flex min-h-[60vh] flex-col items-center justify-center gap-6"
    >
      <h2 className="tier-title font-display text-2xl font-semibold tracking-wide">
        NOVUS MUNDUS
      </h2>
      <div className="flex w-80 flex-col gap-3">
        {steps.map((step, i) => {
          const done = completedKeys.has(step.key);
          return (
            <div
              key={step.key}
              ref={(el) => {
                stepsRef.current[i] = el;
              }}
              className="flex items-center gap-3 opacity-0"
            >
              {done ? (
                <span className="check scale-0 tier-accent-text">●</span>
              ) : (
                <span className="animate-pulse text-zinc-600">◌</span>
              )}
              <span className={done ? "text-zinc-400" : "text-zinc-500"}>
                {step.label}
              </span>
              {done && (
                <span className="ml-auto text-xs text-zinc-600">✓</span>
              )}
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
    { key: "player",     labels: ["Loading player data...",   "Summoning your warrior...",        "Your knights assemble...",         "The champion rises...",             "A legend stirs..."] },
    { key: "gameEngine", labels: ["Fetching game state...",   "Reading the kingdom ledger...",    "Consulting the royal archives...", "The grand council convenes...",     "Fate itself takes notice..."] },
    { key: "user",       labels: ["Loading profile...",       "Scanning your domain...",          "Surveying the silver realm...",    "Inspecting the royal court...",     "Your dominion spans horizons..."] },
    { key: "loot",       labels: ["Checking rewards...",      "Checking unclaimed loot...",       "Tallying the silver spoils...",    "Counting the royal treasury...",    "Mythic treasures await..."] },
  ],
  city: [
    { key: "city",       labels: ["Loading city...",          "Entering the city gates...",       "The silver banners welcome you...", "The golden streets gleam...",      "The city kneels before you..."] },
    { key: "encounters", labels: ["Loading encounters...",    "Scouting for encounters...",       "Knights patrol the streets...",     "The royal guard reports...",       "Legends stalk the shadows..."] },
    { key: "players",    labels: ["Loading players...",       "Counting heads at the tavern...",  "The guild hall buzzes...",          "Nobles gather at court...",        "Champions fill the halls..."] },
  ],
  estate: [
    { key: "estate",     labels: ["Loading estate...",        "Surveying your lands...",          "Your silver estates shimmer...",    "The golden manor awaits...",       "Your mythic fortress looms..."] },
    { key: "player",     labels: ["Loading buildings...",     "Inspecting the buildings...",      "Checking the armory...",           "The royal workshops hum...",        "Legendary forges ignite..."] },
    { key: "gameEngine", labels: ["Loading schedule...",      "Checking daily windows...",        "Reviewing the calendar...",        "The steward presents reports...",   "Time bends to your will..."] },
  ],
  dungeon: [
    { key: "dungeonRun", labels: ["Loading dungeon...",       "Descending into darkness...",      "Silver torches flicker...",        "The golden depths call...",         "The abyss whispers your name..."] },
    { key: "player",     labels: ["Loading hero...",          "Readying your hero...",            "Strapping on silver mail...",      "Donning golden armor...",           "The mythic blade awakens..."] },
    { key: "template",   labels: ["Loading layout...",        "Lighting the torches...",          "Mapping the corridors...",         "Scouts report treasure ahead...",   "Ancient power pulses below..."] },
  ],
  arena: [
    { key: "season",     labels: ["Loading season...",        "Entering the colosseum...",        "The crowd roars...",               "Champions salute the king...",      "The arena trembles with awe..."] },
    { key: "loadout",    labels: ["Loading loadout...",       "Reviewing your loadout...",        "Polishing the silver edge...",     "Sharpening the golden blade...",    "Your mythic aura blazes..."] },
    { key: "participant",labels: ["Loading standings...",     "Checking the standings...",        "Rivals sharpen their swords...",   "The elite prepare for war...",      "Only legends remain..."] },
  ],
  castle: [
    { key: "castle",     labels: ["Loading castle...",        "Approaching the fortress...",      "Silver towers pierce the sky...",  "The golden keep gleams...",         "Your mythic citadel awaits..."] },
    { key: "garrison",   labels: ["Loading garrison...",      "Inspecting the garrison...",       "Knights stand at attention...",    "The elite guard salutes...",        "Legendary forces assemble..."] },
    { key: "court",      labels: ["Loading decrees...",       "Reading court decrees...",         "The council is in session...",     "Royal edicts are proclaimed...",    "The realm awaits your decree..."] },
  ],
  shop: [
    { key: "shopConfig", labels: ["Loading shop...",          "Browsing the wares...",            "Fine silver on display...",        "The royal emporium opens...",       "Mythic relics surface..."] },
    { key: "player",     labels: ["Loading balance...",       "Checking your coin purse...",      "Counting silver marks...",         "The golden coffers overflow...",    "Wealth beyond measure..."] },
    { key: "flashSales", labels: ["Loading sales...",         "Hunting for flash sales...",       "Rare deals spotted...",            "Exclusive offers appear...",        "Once-in-an-age bargains..."] },
  ],
  hero: [
    { key: "heroes",     labels: ["Loading heroes...",        "Assembling your champions...",     "Silver-rank heroes answer...",     "Golden champions march forth...",   "Legends answer the call..."] },
    { key: "player",     labels: ["Loading stats...",         "Reading their legends...",         "Reviewing the chronicles...",      "The royal scribe reports...",       "Their myths are written in stars..."] },
    { key: "estate",     labels: ["Loading sanctuary...",     "Checking the sanctuary...",        "The shrine hums softly...",        "Sacred golden light pulses...",     "The mythic sanctum resonates..."] },
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
  ])
) as Record<keyof typeof TIERED, LoadingStep[]>;
