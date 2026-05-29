"use client";

import { useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import type { PublicKey } from "@solana/web3.js";
import { isNullPubkey, parseAssetV1 } from "novus-mundus-sdk";
import { usePlayer } from "./usePlayer";

/** Sentinel passed to instructions when no hero is committed to a slot. */
export const NO_HERO_SLOT = 255;

export interface LockedHero {
  mint: PublicKey;
  name: string;
  templateId: number;
}

/**
 * Resolves the player's three locked hero slots into asset metadata.
 * Returns a 3-element array; `null` entries are empty slots.
 */
export function useLockedHeroes(): (LockedHero | null)[] {
  const { data: playerData } = usePlayer();
  const { connection } = useConnection();
  const player = playerData?.account;

  const [lockedHeroes, setLockedHeroes] = useState<(LockedHero | null)[]>([null, null, null]);

  // Stable key so unrelated player updates don't trigger a refetch.
  const heroKey = (player?.activeHeroes ?? []).map((h) => h.toBase58()).join(",");

  useEffect(() => {
    if (!player) {
      setLockedHeroes([null, null, null]);
      return;
    }
    let cancelled = false;
    (async () => {
      const slots = player.activeHeroes as PublicKey[];
      const filled = slots
        .map((mint, slot) => ({ mint, slot }))
        .filter((e) => !isNullPubkey(e.mint));

      const resolved: (LockedHero | null)[] = [null, null, null];
      if (filled.length > 0) {
        try {
          const infos = await connection.getMultipleAccountsInfo(filled.map((e) => e.mint));
          filled.forEach((e, i) => {
            const info = infos[i];
            if (!info?.data) return;
            const asset = parseAssetV1(info.data);
            if (!asset) return;
            resolved[e.slot] = {
              mint: e.mint,
              name: asset.name || "Hero",
              templateId: parseInt(asset.attributes.Template ?? "0", 10),
            };
          });
        } catch {
          // Leave slots null on RPC failure.
        }
      }
      if (!cancelled) setLockedHeroes(resolved);
    })();
    return () => {
      cancelled = true;
    };
  }, [heroKey, connection]);

  return lockedHeroes;
}
