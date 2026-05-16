"use client";

import { useRef } from "react";
import { BeatButton, BeatEyebrow } from "./Beat";
import { useRevealOnMount } from "./useRevealOnMount";

/** The storyline's finished onboarding text — WORLD_LORE.md §XII. */
const LINES = [
  "The old world fell. You don't remember it — no one alive does.",
  "What's left is ruin, rubble, and a world that does not care whether you survive.",
  "But you have. And now you are done just surviving.",
  "Claim your ground. Build your name.",
];

interface WorldBeatProps {
  onContinue: () => void;
}

/** Beat 1 of the Arrival — the world, surfaced at last. */
export function WorldBeat({ onContinue }: WorldBeatProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  useRevealOnMount(rootRef, {
    translateY: 14,
    staggerStep: 380,
    staggerStart: 150,
    duration: 800,
  });

  return (
    <div ref={rootRef} className="mx-auto flex max-w-xl flex-col items-center text-center">
      <BeatEyebrow reveal className="mb-9">
        Novus Mundus
      </BeatEyebrow>
      {LINES.map((line, i) => (
        <p
          key={i}
          data-reveal
          className="mb-4 text-lg leading-relaxed text-text-secondary opacity-0"
        >
          {line}
        </p>
      ))}
      <BeatButton reveal onClick={onContinue} className="mt-7 px-6">
        Go on
      </BeatButton>
    </div>
  );
}
