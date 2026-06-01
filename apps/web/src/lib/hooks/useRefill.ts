"use client";

import { useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useEstate } from "@/lib/hooks/useEstate";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { planRefill, buildRefillInstructions, type RefillPlan } from "@/lib/combat/refill";

export interface UseRefillResult {
  /** Costed plan + blockers, or null until accounts load / nothing to do. */
  plan: RefillPlan | null;
  /** Hire + buy the shortfall in one transaction. Throws on a blocked plan. */
  run: () => Promise<string | undefined>;
  /** True while the refill transaction is in flight. */
  running: boolean;
}

/**
 * Legendary "reinforce & arm" action: price the shortfall against the live
 * economy, then hire troops + buy weapons in one transaction. The tier gate is
 * the caller's to enforce — this hook only plans and sends.
 */
export function useRefill(troopsNeeded: number, weaponsNeeded: number): UseRefillResult {
  const { publicKey } = useWallet();
  const { data: playerData } = usePlayer();
  const { data: geData } = useGameEngine();
  const { data: estateData } = useEstate();
  const client = useNovusMundusClient();
  const transact = useTransact();
  const [running, setRunning] = useState(false);

  const player = playerData?.account;
  const ge = geData?.account;
  const estate = estateData?.account;

  const plan = useMemo(() => {
    if (!player || !ge) return null;
    return planRefill({
      player,
      estate,
      ge,
      troopsNeeded,
      weaponsNeeded,
      now: Math.floor(Date.now() / 1000),
    });
  }, [player, ge, estate, troopsNeeded, weaponsNeeded]);

  const run = async (): Promise<string | undefined> => {
    if (!publicKey || !plan) throw new Error("Wallet not connected");
    if (plan.empty) return undefined;
    if (plan.blockers.length > 0) {
      throw new Error(`Cannot refill: ${plan.blockers.join(", ")}`);
    }
    setRunning(true);
    try {
      const ixs = await buildRefillInstructions({
        owner: publicKey,
        gameEngine: client.gameEngine,
        plan,
      });
      if (ixs.length === 0) return undefined;
      const res = await transact.mutateAsync({
        instructions: ixs,
        invalidateKeys: [["player"], ["estate"]],
        successMessage: "Levies raised and the host armed.",
      });
      return res.signature;
    } finally {
      setRunning(false);
    }
  };

  return { plan, run, running };
}
