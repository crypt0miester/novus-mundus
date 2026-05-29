"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WorldBeat } from "./WorldBeat";
import { ChoiceBeat } from "./ChoiceBeat";
import { ClaimBeat } from "./ClaimBeat";
import { JumpAheadBeat } from "./JumpAheadBeat";
import { CairnBeat } from "./CairnBeat";
import { loadJump, clearJump, consumeStaleJumpDropFlag } from "@/lib/jumpstart/persist";
import type { JumpTier } from "@/lib/jumpstart/recipes";
import type { SpawnBearing, SpawnFlavor } from "novus-mundus-sdk";

/**
 * A city the player has chosen to claim. `latitude`/`longitude` are the city
 * centre (kept for downstream radius/distance maths). `spawn*` carry the
 * picked cell from the spawn picker — what actually goes into init_player.
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

type Beat = "world" | "choice" | "claim" | "jump" | "cairn";

interface ArrivalProps {
  /** True when a player account already exists — resume mid-Arrival, skip to the claim. */
  hasPlayer: boolean;
  /** Called once the player clicks through the final beat. */
  onComplete: () => void;
}

/**
 * The Arrival — a paced narrative onboarding that replaces the city-picker
 * form. Four beats: the world, the choice, the claim, the Cairn.
 * PLAYER_JOURNEY_GAMEPLAN.md §7.2.
 */
export function Arrival({ hasPlayer, onComplete }: ArrivalProps) {
  const { disconnect } = useWallet();
  const [beat, setBeat] = useState<Beat>(hasPlayer ? "claim" : "world");
  const [city, setCity] = useState<CityChoice | null>(null);
  // The jump-ahead path reuses ChoiceBeat for the city pick, then routes to
  // the jump rather than the manual claim.
  const [jumping, setJumping] = useState(false);
  // Set when an unfinished jump is found in storage — resumes it on mount.
  const [resumeTier, setResumeTier] = useState<JumpTier | undefined>(undefined);
  /*
   * Surfaces when loadJump() dropped a stale entry on mount — older builds
   * persisted a CityChoice without spawnLat/spawnLong, which this build
   * rejects at the parse boundary. The banner explains the silent restart.
   */
  const [staleJumpDropped, setStaleJumpDropped] = useState(false);

  // A jump that didn't finish before a refresh — route straight back into it.
  // The executor reads its localStorage journal, so confirmed steps are skipped.
  useEffect(() => {
    const pending = loadJump();
    if (pending) {
      setCity(pending.city);
      setResumeTier(pending.tier);
      setJumping(true);
      setBeat("jump");
    } else if (consumeStaleJumpDropFlag()) {
      setStaleJumpDropped(true);
    }
  }, []);

  // Step back a beat; from the first beat, drop the wallet — that returns the
  // app to the connect screen, the true "first page".
  const goBack = () => {
    if (beat === "world") {
      void disconnect();
    } else if (beat === "choice") {
      setJumping(false);
      setBeat("world");
    } else if (beat === "jump") {
      clearJump();
      setBeat("choice");
    } else if (beat === "cairn") {
      setBeat(jumping ? "jump" : "claim");
    } else {
      setBeat("choice");
    }
  };

  return (
    <div className="fixed inset-0 z-9000 overflow-y-auto bg-surface">
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
      <div className="flex min-h-full flex-col items-center justify-center px-4 py-14">
        {beat === "world" && (
          <WorldBeat
            onContinue={() => setBeat("choice")}
            onJump={() => {
              setJumping(true);
              setBeat("choice");
            }}
          />
        )}
        {beat === "choice" && (
          <ChoiceBeat
            onChoose={(chosen) => {
              setCity(chosen);
              setBeat(jumping ? "jump" : "claim");
            }}
          />
        )}
        {beat === "claim" && (
          <ClaimBeat hasPlayer={hasPlayer} city={city} onClaimed={() => setBeat("cairn")} />
        )}
        {beat === "jump" && (
          <JumpAheadBeat city={city} onComplete={onComplete} resumeTier={resumeTier} />
        )}
        {beat === "cairn" && <CairnBeat city={city} onEnter={onComplete} />}
      </div>
    </div>
  );
}
