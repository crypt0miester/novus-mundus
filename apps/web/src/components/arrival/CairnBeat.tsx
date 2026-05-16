"use client";

import { useEffect, useRef } from "react";
import anime from "animejs/lib/anime.es.js";
import { CairnOrb } from "@/components/cairn/CairnOrb";
import { useEstate } from "@/lib/hooks/useEstate";
import { cairnBeat } from "@/lib/narrative";
import { BeatButton, BeatEyebrow } from "./Beat";
import { useRevealOnMount } from "./useRevealOnMount";

interface CairnBeatProps {
  onEnter: () => void;
}

/** When the orb finishes settling, in ms — the text reveal overlaps its tail. */
const ORB_DURATION = 1400;

/**
 * Beat 4 of the Arrival — the stone lights. The Cairn delivers the Arrival line
 * and stays. The Enter button waits until the estate has settled on-chain.
 */
export function CairnBeat({ onEnter }: CairnBeatProps) {
  const { data: estateData } = useEstate();
  const estateReady = !!estateData?.exists;

  const orbRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!orbRef.current) return;
    anime({
      targets: orbRef.current,
      opacity: [0, 1],
      scale: [0.7, 1],
      duration: ORB_DURATION,
      easing: "easeOutQuad",
    });
  }, []);

  useRevealOnMount(textRef, { staggerStart: ORB_DURATION - 450 });

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center text-center">
      <div ref={orbRef} className="opacity-0">
        <CairnOrb mood="raw" act={1} size={104} />
      </div>

      <div ref={textRef} className="mt-9 flex flex-col items-center">
        <BeatEyebrow reveal className="mb-3">
          The Cairn
        </BeatEyebrow>
        <p
          data-reveal
          className="mb-8 max-w-lg text-base leading-relaxed text-text-secondary opacity-0"
        >
          {cairnBeat("arrival")}
        </p>
        <BeatButton
          reveal
          disabled={!estateReady}
          disabledTone="waiting"
          onClick={onEnter}
        >
          {estateReady ? "Enter the holding" : "The stone is waking…"}
        </BeatButton>
      </div>
    </div>
  );
}
