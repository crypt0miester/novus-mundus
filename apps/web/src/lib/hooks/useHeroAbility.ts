"use client";

import { useCallback, useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { PublicKey } from "@solana/web3.js";
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
 * Read an on-chain unix-second stamp (a `bigint`) as a plain number.
 *
 * A player account written before a given timestamp field existed decodes
 * arbitrary bytes at that offset, so a stale account can yield a value of any
 * size. A real stamp is only ~2^31; anything implausible (overflowing, or
 * simply not a sane time) reads back as 0, which the cooldown/effect logic
 * already treats as "unused / expired".
 */
function stampSeconds(v: bigint | null | undefined): number {
  // `Number(bigint)` never throws; an over-large value is merely imprecise,
  // then the range check below rejects nonsense.
  const n = v !== null && v !== undefined ? Number(v) : 0;
  return Number.isFinite(n) && n > 0 && n < 1e11 ? n : 0;
}

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
  const lastUsedAt = stampSeconds(data?.account?.abilityLastUsedAt?.[slot]);
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
    const expiresAt = stampSeconds(acct.pendingEffectExpiresAt);
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
      const [heroTemplate] = await deriveHeroTemplatePda(templateId);
      const ix = await createUseHeroAbilityInstruction(
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
