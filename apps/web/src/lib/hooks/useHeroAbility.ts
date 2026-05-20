"use client";

import { useCallback, useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  createUseHeroAbilityInstruction,
  deriveHeroTemplatePda,
  abilityCooldownStatus,
} from "novus-mundus-sdk";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useTransact } from "./useTransact";
import { usePlayer } from "./usePlayer";
import { useNow } from "./useNow";

/**
 * Cooldown status for an active hero slot's ability.
 *
 * Reads `ability_last_used_at[slot]` from the player account and combines
 * with the locked hero's template `abilityCooldownSecs` (passed by caller —
 * the cooldown lives on the template, not the player).
 */
export function useHeroAbilityCooldown(slot: number, cooldownSecs: number) {
  const { data } = usePlayer();
  // Always tick; rendered cooldown timer needs per-second refresh.
  const now = useNow(true);
  const lastUsedAt = data?.account?.abilityLastUsedAt?.[slot]?.toNumber?.() ?? 0;
  return useMemo(
    () => abilityCooldownStatus(lastUsedAt, cooldownSecs, now),
    [lastUsedAt, cooldownSecs, now],
  );
}

/**
 * Returns the current pending one-shot effect, or null if none active.
 * Auto-expires when `pendingEffectExpiresAt` has elapsed.
 */
export function usePendingEffect() {
  const { data } = usePlayer();
  const now = useNow(true);
  return useMemo(() => {
    const acct = data?.account;
    if (!acct) return null;
    const kind = acct.pendingEffectKind ?? 0;
    if (kind === 0) return null;
    const expiresAt = acct.pendingEffectExpiresAt?.toNumber?.() ?? 0;
    if (expiresAt <= now) return null;
    return {
      kind,
      stat: acct.pendingEffectStat ?? 0,
      param: acct.pendingEffectParam ?? 0,
      expiresAt,
      remainingSecs: expiresAt - now,
    };
  }, [data, now]);
}

/**
 * Mutation hook: triggers a hero's active ability via the use_ability ix.
 *
 * Usage:
 *   const useAbility = useUseAbility();
 *   await useAbility(heroMint, templateId, slotIndex, reportPhase);
 */
export function useUseAbility() {
  const { publicKey } = useWallet();
  const client = useNovusMundusClient();
  const transact = useTransact();

  return useCallback(
    async (
      heroMint: PublicKey,
      templateId: number,
      slotIndex: number,
      reportPhase?: (phase: any) => void,
    ) => {
      if (!publicKey) throw new Error("Wallet not connected");
      const [heroTemplate] = deriveHeroTemplatePda(templateId);
      const ix = createUseHeroAbilityInstruction(
        {
          owner: publicKey,
          gameEngine: client.gameEngine,
          heroMint,
          heroTemplate,
        },
        { slotIndex },
      );
      return transact.mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: "Ability triggered!",
        onPhase: reportPhase,
      });
    },
    [publicKey, client, transact],
  );
}
