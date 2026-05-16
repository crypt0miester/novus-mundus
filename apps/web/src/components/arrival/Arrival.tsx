"use client";

import { useState } from "react";
import { WorldBeat } from "./WorldBeat";
import { ChoiceBeat } from "./ChoiceBeat";
import { ClaimBeat } from "./ClaimBeat";
import { CairnBeat } from "./CairnBeat";

/** A city the player has chosen to claim — the fields the claim transaction needs. */
export interface CityChoice {
  cityId: number;
  name: string;
  cityType: number;
  latitude: number;
  longitude: number;
}

type Beat = "world" | "choice" | "claim" | "cairn";

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
  const [beat, setBeat] = useState<Beat>(hasPlayer ? "claim" : "world");
  const [city, setCity] = useState<CityChoice | null>(null);

  return (
    <div className="fixed inset-0 z-9000 overflow-y-auto bg-surface">
      <div className="flex min-h-full flex-col items-center justify-center px-4 py-14">
        {beat === "world" && <WorldBeat onContinue={() => setBeat("choice")} />}
        {beat === "choice" && (
          <ChoiceBeat
            onChoose={(chosen) => {
              setCity(chosen);
              setBeat("claim");
            }}
          />
        )}
        {beat === "claim" && (
          <ClaimBeat
            hasPlayer={hasPlayer}
            city={city}
            onClaimed={() => setBeat("cairn")}
          />
        )}
        {beat === "cairn" && <CairnBeat onEnter={onComplete} />}
      </div>
    </div>
  );
}
