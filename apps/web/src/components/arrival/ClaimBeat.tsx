"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { TransactionInstruction } from "@solana/web3.js";
import { useUser } from "@/lib/hooks/useUser";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useEstate } from "@/lib/hooks/useEstate";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useTransact } from "@/lib/hooks/useTransact";
import {
  createInitUserInstruction,
  createInitPlayerInstruction,
  createCreateEstateInstruction,
} from "novus-mundus-sdk";
import { BeatButton, BeatEyebrow } from "./Beat";
import type { CityChoice } from "./Arrival";

interface ClaimBeatProps {
  hasPlayer: boolean;
  city: CityChoice | null;
  onClaimed: () => void;
}

type Phase = "idle" | "name" | "estate" | "error";

/**
 * Beat 3 of the Arrival — the claim. One act of claiming, two transactions:
 * init_user + init_player, then create_estate. (The research extension is not
 * here — it belongs to Act II.)
 */
export function ClaimBeat({ hasPlayer, city, onClaimed }: ClaimBeatProps) {
  const { publicKey } = useWallet();
  const { data: userData } = useUser();
  const { data: playerData } = usePlayer();
  const { data: estateData } = useEstate();
  const { data: geData } = useGameEngine();
  const transact = useTransact();

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  const ge = geData?.pubkey;
  const busy = phase === "name" || phase === "estate";
  const ready = !!publicKey && !!ge && (hasPlayer || !!city) && !busy;

  const run = async () => {
    if (!publicKey || !ge) return;
    setError(null);
    try {
      // Step 1 — claim your name (init_user + init_player). Skipped on resume.
      if (!userData?.exists || !playerData?.exists) {
        if (!city) throw new Error("No ground was chosen.");
        const instructions: TransactionInstruction[] = [];
        if (!userData?.exists) {
          instructions.push(
            createInitUserInstruction({ owner: publicKey, gameEngine: ge }),
          );
        }
        if (!playerData?.exists) {
          instructions.push(
            createInitPlayerInstruction({
              owner: publicKey,
              gameEngine: ge,
              startingCityId: city.cityId,
              cityLatitude: city.latitude,
              cityLongitude: city.longitude,
            }),
          );
        }
        setPhase("name");
        await transact.mutateAsync({
          instructions,
          invalidateKeys: [
            ["user", publicKey.toBase58()],
            ["player", publicKey.toBase58()],
          ],
          successMessage: "Your name is on the land.",
        });
      }

      // Step 2 — raise the estate (create_estate).
      if (!estateData?.exists) {
        const cityId = city?.cityId ?? playerData?.account?.currentCity;
        if (cityId === undefined) throw new Error("No city chosen for the estate.");
        setPhase("estate");
        await transact.mutateAsync({
          instructions: [
            createCreateEstateInstruction(
              { owner: publicKey, gameEngine: ge },
              { cityId },
            ),
          ],
          invalidateKeys: [["estate"], ["player"]],
          successMessage: "The estate is yours.",
        });
      }

      onClaimed();
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : "The claim did not hold. Try again.");
    }
  };

  const stepLabel =
    phase === "name"
      ? "Driving the stakes…"
      : phase === "estate"
        ? "Raising the estate…"
        : null;

  return (
    <div className="mx-auto flex max-w-md flex-col items-center text-center">
      <BeatEyebrow className="mb-2">The Claim</BeatEyebrow>
      <h2 className="tier-title mb-3 font-display text-2xl font-bold tracking-wide">
        Drive your stakes
      </h2>
      <p className="mb-7 text-sm leading-relaxed text-text-secondary">
        A dozen came up this road before you and counted gold they did not have.
        You will not. You drive your stakes into the dirt — and the ground becomes
        a thing with an edge: yours within it, the world without.
      </p>

      {stepLabel && (
        <p className="mb-4 animate-pulse font-mono text-sm text-text-gold">{stepLabel}</p>
      )}
      {error && <p className="mb-4 max-w-sm text-sm text-red-500">{error}</p>}

      <BeatButton disabled={!ready} onClick={run}>
        {busy ? "Hold…" : phase === "error" ? "Drive them again" : "Claim this ground"}
      </BeatButton>
    </div>
  );
}
