"use client";

import { useRef } from "react";
import { BeatButton, BeatEyebrow } from "./Beat";
import { useRevealOnMount } from "./useRevealOnMount";

/** The storyline's finished onboarding text. */
const LINES = [
  "The old world fell. You don't remember it,",
  "No one alive does.",
  "What's left is ruin, rubble, and a world that does not care whether you survive.",
  "But you have. And now you are done just surviving.",
  "Claim your ground. Build your name.",
];

interface WorldBeatProps {
  onContinue: () => void;
  /** Skip the early game — opens the jump-ahead path. */
  onJump: () => void;
}

/** Beat 1 of the Arrival — the world, surfaced at last. */
export function WorldBeat({ onContinue, onJump }: WorldBeatProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  useRevealOnMount(rootRef, {
    translateY: 14,
    staggerStep: 380,
    staggerStart: 150,
    duration: 800,
  });

  return (
    <div ref={rootRef} className="mx-auto flex max-w-xl flex-col items-center text-center">
      {/* The mark, masked from the canonical vector logo so it tints to the
          bronze accent — a gold logo would wash out on the parchment bg. */}
      <span
        data-reveal
        aria-hidden
        className="mb-7 block h-16 w-16 text-text-gold opacity-0"
        style={{
          backgroundColor: "currentColor",
          maskImage: "url(/img/logo/logo.svg)",
          WebkitMaskImage: "url(/img/logo/logo.svg)",
          maskRepeat: "no-repeat",
          WebkitMaskRepeat: "no-repeat",
          maskPosition: "center",
          WebkitMaskPosition: "center",
          maskSize: "contain",
          WebkitMaskSize: "contain",
        }}
      />
      <BeatEyebrow reveal className="mb-9">
        Novus Mundus
      </BeatEyebrow>
      {LINES.map((line, i) => (
        <p
          key={i}
          data-reveal
          className="mb-4 text-sm leading-relaxed text-text-secondary opacity-0 lowercase"
        >
          {line}
        </p>
      ))}
      <div data-reveal className="mt-7 flex items-center gap-3 opacity-0">
        <BeatButton onClick={onContinue} className="px-6">
          go on
        </BeatButton>
        <button
          type="button"
          onClick={onJump}
          className="rounded-full border border-[var(--tier-accent)] px-5 py-2.5 text-sm font-medium lowercase text-text-gold transition-colors hover:bg-surface-raised"
        >
          jump ahead
        </button>
      </div>
    </div>
  );
}
