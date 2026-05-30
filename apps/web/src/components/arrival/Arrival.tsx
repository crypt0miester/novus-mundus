"use client";

import { useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { createTimeline, svg, type Timeline } from "animejs";
import { WorldBeat } from "./WorldBeat";
import { ChoiceBeat } from "./ChoiceBeat";
import { ClaimBeat } from "./ClaimBeat";
import { JumpAheadBeat } from "./JumpAheadBeat";
import { CairnBeat } from "./CairnBeat";
import { GLYPH, GLYPH_VIEWBOX } from "./beatGlyphs";
import { useAnimeScope } from "@/lib/hooks/useAnimeScope";
import { DUR, EASE } from "@/lib/motion/tokens";
import { loadJump, clearJump, consumeStaleJumpDropFlag } from "@/lib/jumpstart/persist";
import type { JumpTier } from "@/lib/jumpstart/recipes";
import type { SpawnBearing, SpawnFlavor } from "novus-mundus-sdk";

/**
 * A city the player has chosen to claim. `latitude`/`longitude` are the city
 * centre (kept for downstream radius/distance maths). `spawn*` carry the
 * picked cell from the spawn picker, what actually goes into init_player.
 * The picker runs at the moment of choosing, so these are always present.
 */
export interface CityChoice {
  cityId: number;
  name: string;
  cityType: number;
  latitude: number;
  longitude: number;
  spawnLat: number;
  spawnLong: number;
  spawnFlavor: SpawnFlavor;
  spawnBearing: SpawnBearing;
}

export type Beat = "world" | "choice" | "claim" | "jump" | "cairn";

interface ArrivalProps {
  /** True when a player account already exists; resume mid-Arrival, skip to the claim. */
  hasPlayer: boolean;
  /** Called once the player clicks through the final beat. */
  onComplete: () => void;
}

/**
 * The Arrival, a paced narrative onboarding that replaces the city-picker
 * form. Four beats: the world, the choice, the claim, the Cairn.
 * PLAYER_JOURNEY_GAMEPLAN.md §7.2.
 *
 * Beats cross with a cinematic page-turn (3b in ANIMEJS_MOTION_OPPORTUNITIES.md):
 * the outgoing lines pull in then fade, a centre ink sigil etches and morphs to
 * the next beat's glyph, the React swap lands on the timeline midpoint, and the
 * incoming beat cascades up via its own useRevealOnMount.
 */
export function Arrival({ hasPlayer, onComplete }: ArrivalProps) {
  const { disconnect } = useWallet();
  const [beat, setBeat] = useState<Beat>(hasPlayer ? "claim" : "world");
  const [city, setCity] = useState<CityChoice | null>(null);
  // The beat the director is crossing toward. Non-null only mid-transition; the
  // useAnimeScope below keys its timeline on it, and the state swap (which sets
  // `beat` to this and clears `pending`) lands on the timeline midpoint.
  const [pending, setPending] = useState<Beat | null>(null);
  // The jump-ahead path reuses ChoiceBeat for the city pick, then routes to
  // the jump rather than the manual claim.
  const [jumping, setJumping] = useState(false);
  // Set when an unfinished jump is found in storage; resumes it on mount.
  const [resumeTier, setResumeTier] = useState<JumpTier | undefined>(undefined);
  // Surfaces when loadJump() dropped a stale entry on mount: older builds
  // persisted a CityChoice without spawnLat/spawnLong, which this build
  // rejects at the parse boundary. The banner explains the silent restart.
  const [staleJumpDropped, setStaleJumpDropped] = useState(false);

  // The transition overlay (sigil lives here) and the in-flight timeline, held
  // for the re-entrancy guard: a second request cancels the first cleanly.
  const overlayRef = useRef<HTMLDivElement>(null);
  const inFlight = useRef<Timeline | null>(null);

  // A jump that didn't finish before a refresh; route straight back into it.
  // The executor reads its localStorage journal, so confirmed steps are skipped.
  useEffect(() => {
    const pendingJump = loadJump();
    if (pendingJump) {
      setCity(pendingJump.city);
      setResumeTier(pendingJump.tier);
      setJumping(true);
      setBeat("jump");
    } else if (consumeStaleJumpDropFlag()) {
      setStaleJumpDropped(true);
    }
  }, []);

  // Request a crossing to `next`. Routes the state swap through the director so
  // it lands with the morph. No-op when we're already settled there, or already
  // crossing there; a request to a *different* beat mid-cross retargets (the
  // builder cancels the in-flight timeline below).
  const goToBeat = (next: Beat) => {
    if (next === pending) return;
    if (next === beat && !pending) return;
    setPending(next);
  };

  // The beat director. Keyed on `pending`: when a crossing is requested, etch +
  // morph the sigil while the outgoing lines pull in and fade, swap React state
  // at the midpoint via tl.call(), and let the incoming beat cascade itself in.
  // `pending` is cleared on completion (not at the midpoint) so committing the
  // swap does not re-run this effect and cancel the still-playing tail.
  // Under reduced motion the builder commits the swap and the final glyph
  // directly, skipping the choreography.
  useAnimeScope({ root: overlayRef, deps: [pending], revertOnCleanup: false }, ({ reduce }) => {
    const next = pending;
    if (!next) return;

    if (reduce) {
      // Set the final glyph and swap immediately, no choreography. The sigil
      // stays invisible (opacity 0 at rest), so only the glyph identity matters.
      overlayRef.current?.querySelector("#beat-sigil")?.setAttribute("d", GLYPH[next]);
      setBeat(next);
      setPending(null);
      return;
    }

    // Re-entrancy guard: a mashed back/forward cancels the in-flight cross so
    // the new one retargets from the live DOM rather than fighting it.
    inFlight.current?.cancel();

    const tl = createTimeline({ defaults: { duration: DUR.base, ease: EASE.out } });

    // Outgoing content: an anticipatory pull-in (inBack) before it sinks and
    // fades. Scoped to the current beat so the not-yet-mounted next beat is
    // untouched.
    tl.add(
      "[data-beat-current] [data-reveal]",
      { opacity: [1, 0], y: [0, -10], ease: EASE.anticipate },
      0,
    );

    // The ink sigil rises, etches itself, then morphs its silhouette from the
    // current beat's glyph to the next beat's mid-cross. createDrawable resets
    // the stroke each pass so it draws fresh; the glyphs are point-matched so
    // morphTo interpolates cleanly.
    const [sigil] = svg.createDrawable("#beat-sigil");
    tl.add("#beat-sigil", { opacity: [0, 1], duration: DUR.fast }, "<<");
    tl.add(sigil, { draw: ["0 0", "0 1"], duration: DUR.base }, "<<");
    // morphTo needs a target ELEMENT (not a path string, and not a selector
    // that may fail to resolve at build time): aim the hidden target at the next
    // glyph, then morph the visible sigil toward that element. The glyphs are
    // point-matched (M + 8C + Z) so the interpolation stays clean. If the target
    // is missing, the draw-in and crossfade still carry the beat.
    const sigilTarget = overlayRef.current?.querySelector<SVGPathElement>("#beat-sigil-target");
    if (sigilTarget) {
      sigilTarget.setAttribute("d", GLYPH[next]);
      tl.add("#beat-sigil", { d: svg.morphTo(sigilTarget) }, "<<+=120");
    }

    // Swap React state at the midpoint so visuals and state commit together.
    // Only `beat` flips here; `pending` is cleared in then() so the effect
    // does not re-run and tear down the dissolve that plays after this.
    tl.call(() => setBeat(next), "+=0");

    // The sigil dissolves as the incoming beat takes the page. The new beat's
    // own useRevealOnMount cascades its [data-reveal] lines up from below.
    tl.add("#beat-sigil", { opacity: [1, 0], duration: DUR.base }, "+=120");

    // Clear the request only once the whole cross has settled, retiring the
    // in-flight handle so a later crossing starts clean.
    tl.then(() => {
      if (inFlight.current === tl) inFlight.current = null;
      setPending((p) => (p === next ? null : p));
    });

    inFlight.current = tl;
    tl.play();
  });

  // Step back a beat; from the first beat, drop the wallet, which returns the
  // app to the connect screen, the true "first page".
  const goBack = () => {
    if (beat === "world") {
      void disconnect();
    } else if (beat === "choice") {
      setJumping(false);
      goToBeat("world");
    } else if (beat === "jump") {
      clearJump();
      goToBeat("choice");
    } else if (beat === "cairn") {
      goToBeat(jumping ? "jump" : "claim");
    } else {
      goToBeat("choice");
    }
  };

  return (
    <div ref={overlayRef} className="fixed inset-0 z-9000 overflow-y-auto bg-surface">
      <button
        type="button"
        onClick={goBack}
        className="absolute left-4 top-4 z-10 text-xs font-medium lowercase text-text-muted transition-colors hover:text-text-gold"
      >
        {beat === "world" ? "retreat" : "back"}
      </button>
      {staleJumpDropped && (
        <div
          role="alert"
          className="absolute left-1/2 top-4 z-20 w-[min(36rem,calc(100%-2rem))] -translate-x-1/2 rounded border border-border-warn bg-surface-raised px-4 py-2 text-xs lowercase text-text-warn shadow-sm"
        >
          a previous unfinished jump couldn't be resumed under the new build. you'll need to re-pick
          your ground.
        </div>
      )}
      {/* The page-turn sigil. Pinned at page centre behind the beat content
          (revealed as the outgoing lines fade), always click-through, and
          invisible between transitions (the director fades it in and out). Its
          <path> point-count matches every glyph so morphTo and the draw-in
          interpolate cleanly. */}
      <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center">
        <svg aria-hidden viewBox={GLYPH_VIEWBOX} className="h-28 w-28 text-text-gold" fill="none">
          <title>beat sigil</title>
          <path
            id="beat-sigil"
            d={GLYPH[beat]}
            stroke="currentColor"
            strokeWidth={2}
            strokeLinejoin="round"
            opacity={0}
          />
          {/* Hidden morph target. svg.morphTo needs a real element to read, */}
          {/* not a path string, so the director points this at the next */}
          {/* glyph and morphs the visible sigil toward it. */}
          <path id="beat-sigil-target" d={GLYPH[beat]} stroke="none" opacity={0} />
        </svg>
      </div>
      <div className="relative z-10 flex min-h-full flex-col items-center justify-center px-4 py-14">
        <div data-beat-current className="contents">
          {beat === "world" && (
            <WorldBeat
              onContinue={() => goToBeat("choice")}
              onJump={() => {
                setJumping(true);
                goToBeat("choice");
              }}
            />
          )}
          {beat === "choice" && (
            <ChoiceBeat
              onChoose={(chosen) => {
                setCity(chosen);
                goToBeat(jumping ? "jump" : "claim");
              }}
            />
          )}
          {beat === "claim" && (
            <ClaimBeat hasPlayer={hasPlayer} city={city} onClaimed={() => goToBeat("cairn")} />
          )}
          {beat === "jump" && (
            <JumpAheadBeat city={city} onComplete={onComplete} resumeTier={resumeTier} />
          )}
          {beat === "cairn" && <CairnBeat city={city} onEnter={onComplete} />}
        </div>
      </div>
    </div>
  );
}
