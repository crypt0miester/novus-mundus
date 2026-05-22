"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WorldBeat } from "./WorldBeat";
import { ChoiceBeat } from "./ChoiceBeat";
import { ClaimBeat } from "./ClaimBeat";
import { JumpAheadBeat } from "./JumpAheadBeat";
import { CairnBeat } from "./CairnBeat";
import { loadJump, clearJump } from "@/lib/jumpstart/persist";
import type { JumpTier } from "@/lib/jumpstart/recipes";

/** A city the player has chosen to claim — the fields the claim transaction needs. */
export interface CityChoice {
  cityId: number;
  name: string;
  cityType: number;
  latitude: number;
  longitude: number;
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

  // A jump that didn't finish before a refresh — route straight back into it.
  // The executor reads its localStorage journal, so confirmed steps are skipped.
  useEffect(() => {
    const pending = loadJump();
    if (pending) {
      setCity(pending.city);
      setResumeTier(pending.tier);
      setJumping(true);
      setBeat("jump");
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
        {beat === "cairn" && <CairnBeat onEnter={onComplete} />}
      </div>
    </div>
  );
}
