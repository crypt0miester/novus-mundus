"use client";

import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { parseAssetV1, type ParsedAssetV1 } from "novus-mundus-sdk";

/** MPL Core program — owns hero NFT (AssetV1) accounts. */
const MPL_CORE_PROGRAM_ID = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

export interface UnlockedHero {
  mint: PublicKey;
  name: string;
  asset: ParsedAssetV1;
}

/**
 * Hero NFTs the connected wallet currently holds — heroes that are NOT locked
 * into the player account and NOT escrowed in a dungeon run. These are the
 * heroes eligible to be sent into a dungeon: dungeon entry escrows a
 * wallet-held hero for the duration of the run.
 *
 * A locked hero is owned by the PlayerAccount PDA, and a hero already in a run
 * is owned by the DungeonRun PDA — neither is wallet-owned, so both are
 * naturally excluded here.
 */
export function useUnlockedHeroes(): UnlockedHero[] {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [heroes, setHeroes] = useState<UnlockedHero[]>([]);

  useEffect(() => {
    if (!publicKey) {
      setHeroes([]);
      return;
    }
    let cancelled = false;
    connection
      .getProgramAccounts(MPL_CORE_PROGRAM_ID, {
        // AssetV1 layout: the owner pubkey begins at byte offset 1.
        filters: [{ memcmp: { offset: 1, bytes: publicKey.toBase58() } }],
      })
      .then((accounts) => {
        if (cancelled) return;
        const found: UnlockedHero[] = [];
        for (const { pubkey, account } of accounts) {
          try {
            const asset = parseAssetV1(account.data);
            // Only hero assets carry a "Template" attribute.
            if (!asset?.attributes.Template) continue;
            found.push({ mint: pubkey, name: asset.name || "Hero", asset });
          } catch {
            /* skip unparseable assets */
          }
        }
        setHeroes(found);
      })
      .catch(() => {
        if (!cancelled) setHeroes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [connection, publicKey?.toBase58()]);

  return heroes;
}
