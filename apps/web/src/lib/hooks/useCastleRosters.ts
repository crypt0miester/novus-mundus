"use client";

import { useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  deriveCourtPda,
  parseCourtPosition,
  parseGarrisonContribution,
  AccountKey,
  PROGRAM_ID as NOVUS_PROGRAM_ID,
  type CourtPositionAccount,
  type GarrisonContributionAccount,
} from "novus-mundus-sdk";
import { getBase58Decoder } from "@solana/codecs-strings";

// Resolve a batch of player PDAs to their owner wallets. The court-candidate
// effect in castle-tab also depends on this, so the resolver stays owned by
// the component and is threaded in as a callback to keep behavior identical.
type WalletResolver = (playerPdas: PublicKey[]) => Promise<Map<string, PublicKey>>;

type CourtRosterEntry = {
  position: number;
  account: CourtPositionAccount;
  ownerWallet: PublicKey | null;
};

type GarrisonRosterEntry = {
  account: GarrisonContributionAccount;
  ownerWallet: PublicKey | null;
};

/**
 * Court roster — court positions are enumerable: 5 fixed slots per castle.
 * Derives all 5 court PDAs, fetches + parses them, and resolves holder wallets.
 * Re-fetches when the castle pubkey, connection, or `refresh` value changes.
 */
export function useCourtRoster({
  castlePda,
  refresh,
  resolveWallets,
}: {
  castlePda: PublicKey | null;
  refresh: unknown;
  resolveWallets: WalletResolver;
}): CourtRosterEntry[] {
  const { connection } = useConnection();
  const [courtRoster, setCourtRoster] = useState<CourtRosterEntry[]>([]);

  useEffect(() => {
    if (!castlePda) {
      setCourtRoster([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const courtPdas = await Promise.all(
        [0, 1, 2, 3, 4].map(async (i) => (await deriveCourtPda(castlePda, i))[0]),
      );
      const infos = await connection.getMultipleAccountsInfo(courtPdas);
      const occupied: { position: number; account: CourtPositionAccount }[] = [];
      for (let i = 0; i < infos.length; i++) {
        const info = infos[i];
        if (!info) continue;
        const parsed = parseCourtPosition(info);
        if (parsed) occupied.push({ position: i, account: parsed });
      }
      const wallets = await resolveWallets(occupied.map((c) => c.account.holder));
      if (cancelled) return;
      setCourtRoster(
        occupied.map((c) => ({
          position: c.position,
          account: c.account,
          ownerWallet: wallets.get(c.account.holder.toBase58()) ?? null,
        })),
      );
    })().catch(() => {
      if (!cancelled) setCourtRoster([]);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [castlePda?.toBase58(), connection, refresh]);

  return courtRoster;
}

/**
 * Garrison roster — fetched via getProgramAccounts filtered on the castle
 * pubkey (account_key byte at offset 0, castle pubkey at offset 1), then
 * resolves contributor wallets. Re-fetches under the same conditions as
 * the court roster.
 */
export function useGarrisonRoster({
  castlePda,
  refresh,
  resolveWallets,
}: {
  castlePda: PublicKey | null;
  refresh: unknown;
  resolveWallets: WalletResolver;
}): GarrisonRosterEntry[] {
  const { connection } = useConnection();
  const [garrisonRoster, setGarrisonRoster] = useState<GarrisonRosterEntry[]>([]);

  useEffect(() => {
    if (!castlePda) {
      setGarrisonRoster([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const keyByte = getBase58Decoder().decode(Uint8Array.of(AccountKey.CastleGarrison));
      const accounts = await connection.getProgramAccounts(NOVUS_PROGRAM_ID, {
        filters: [
          { memcmp: { offset: 0, bytes: keyByte } },
          // castle pubkey is the first field after the 1-byte account_key
          { memcmp: { offset: 1, bytes: castlePda.toBase58() } },
        ],
      });
      const parsedList: GarrisonContributionAccount[] = [];
      for (const { account } of accounts) {
        const parsed = parseGarrisonContribution(account);
        if (parsed) parsedList.push(parsed);
      }
      const wallets = await resolveWallets(parsedList.map((g) => g.contributor));
      if (cancelled) return;
      setGarrisonRoster(
        parsedList.map((g) => ({
          account: g,
          ownerWallet: wallets.get(g.contributor.toBase58()) ?? null,
        })),
      );
    })().catch(() => {
      if (!cancelled) setGarrisonRoster([]);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [castlePda?.toBase58(), connection, refresh]);

  return garrisonRoster;
}
