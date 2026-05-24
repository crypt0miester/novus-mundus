"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { TransactionInstruction } from "@solana/web3.js";
import { useUser } from "@/lib/hooks/useUser";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useEstate } from "@/lib/hooks/useEstate";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { packInstructions } from "@/lib/solana/pack";
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

type Phase = "idle" | "claiming" | "error";

/**
 * Beat 3 of the Arrival — the claim.
 *
 * One act of claiming. The work is `init_user` + `init_player` +
 * `create_estate`, but how many transactions that takes is *not* fixed: the
 * instructions are merged and only split when they overflow the transaction
 * size limit (see `packInstructions`). A brand-new wallet may need two
 * signatures; an existing user joining a new kingdom (no `init_user`) signs
 * once. (The research extension is not here — it belongs to Act II.)
 */
export function ClaimBeat({ hasPlayer, city, onClaimed }: ClaimBeatProps) {
  const { publicKey } = useWallet();
  const { data: userData } = useUser();
  const { data: playerData } = usePlayer();
  const { data: estateData } = useEstate();
  const { data: geData } = useGameEngine();
  const transact = useTransact();
  const client = useNovusMundusClient();

  const [phase, setPhase] = useState<Phase>("idle");
  const [stepLabel, setStepLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ge = geData?.pubkey;
  const busy = phase === "claiming";
  const ready = !!publicKey && !!ge && (hasPlayer || !!city) && !busy;

  const run = async () => {
    if (!publicKey || !ge) return;
    setError(null);
    try {
      // Collect every instruction this claim needs. init_user is skipped for
      // an existing user; init_player/create_estate are skipped on resume.
      const userIx = !userData?.exists
        ? createInitUserInstruction({ owner: publicKey, gameEngine: ge })
        : null;

      let playerIx: TransactionInstruction | null = null;
      if (!playerData?.exists) {
        if (!city) throw new Error("no ground was chosen.");
        playerIx = createInitPlayerInstruction({
          owner: publicKey,
          gameEngine: ge,
          startingCityId: city.cityId,
          cityLatitude: city.spawnLat,
          cityLongitude: city.spawnLong,
        });
      }

      let estateIx: TransactionInstruction | null = null;
      if (!estateData?.exists) {
        const cityId = city?.cityId ?? playerData?.account?.currentCity;
        if (cityId === undefined) throw new Error("no city chosen for the estate.");
        estateIx = createCreateEstateInstruction({ owner: publicKey, gameEngine: ge }, { cityId });
      }

      const instructions = [userIx, playerIx, estateIx].filter(
        (ix): ix is TransactionInstruction => ix !== null,
      );
      if (instructions.length === 0) {
        onClaimed();
        return;
      }

      setPhase("claiming");

      // Merge into as few transactions as fit under the size limit — often
      // one, two only when a brand-new wallet's instructions overflow it.
      const groups = await packInstructions(instructions, client, publicKey);

      for (const group of groups) {
        const hasName =
          (userIx !== null && group.includes(userIx)) ||
          (playerIx !== null && group.includes(playerIx));
        const hasEstate = estateIx !== null && group.includes(estateIx);

        setStepLabel(
          hasName && hasEstate
            ? "driving the stakes, raising the estate…"
            : hasEstate
              ? "raising the estate…"
              : "driving the stakes…",
        );

        const invalidateKeys: string[][] = [];
        if (hasName) {
          invalidateKeys.push(["user", publicKey.toBase58()], ["player", publicKey.toBase58()]);
        }
        if (hasEstate) invalidateKeys.push(["estate"], ["player"]);

        await transact.mutateAsync({
          instructions: group,
          invalidateKeys,
          successMessage:
            hasName && hasEstate
              ? "your name is on the land, and the estate is yours."
              : hasEstate
                ? "the estate is yours."
                : "your name is on the land.",
        });
      }

      onClaimed();
    } catch (e) {
      setPhase("error");
      setStepLabel(null);
      setError(e instanceof Error ? e.message : "the claim did not hold. Try again.");
    }
  };

  return (
    <div className="mx-auto flex max-w-md flex-col items-center text-center">
      <BeatEyebrow className="mb-2">the claim</BeatEyebrow>
      <h2 className="tier-title mb-3 font-display text-2xl font-bold tracking-wide">
        drive your stakes
      </h2>
      <p className="mb-7 text-sm leading-relaxed text-text-secondary">
        a dozen came up this road before you and counted gold they did not have.
      </p>
      <p className="mb-7 text-sm leading-relaxed text-text-secondary">you will not.</p>
      <p className="mb-4 text-sm leading-relaxed text-text-secondary">
        you drive your stakes into the dirt, and the ground becomes a thing with an edge:
      </p>
      <p className="mb-4 text-sm leading-relaxed text-text-secondary">
        yours within it, the world without.
      </p>

      {stepLabel && (
        <p className="mb-4 animate-pulse font-mono text-sm text-text-gold lowercase">{stepLabel}</p>
      )}

      <BeatButton disabled={!ready} onClick={run}>
        {busy ? "hold…" : phase === "error" ? "drive them again" : "claim this ground"}
      </BeatButton>
      {error && <p className="mt-4 max-w-sm text-sm text-red-500 lowercase">{error}</p>}
    </div>
  );
}
