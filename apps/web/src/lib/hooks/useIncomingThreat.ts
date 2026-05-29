"use client";

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import { useShallow } from "zustand/react/shallow";
import { isNullPubkey } from "novus-mundus-sdk";
import { usePlayer } from "./usePlayer";
import { useSubscriptionStatus } from "./useDerived";
import { useWorldPlayers } from "./world";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useAccountStore } from "@/lib/store/accounts";

/** The top charter. Tier ladder is Rookie/Expert/Epic/Legendary = 0/1/2/3. */
const LEGENDARY_TIER = 3;

/** RallyTargetType.Player — a rally aimed at a defender. */
const RALLY_TARGET_PLAYER = 0;
/** RallyTargetType.Castle — a rally aimed at a held castle. */
const RALLY_TARGET_CASTLE = 2;

/**
 * RallyStatus.Combat. Statuses 0/1/2 (Gathering/Marching/Combat) are still bound
 * for you; 3+ (Returning/Completed/Cancelled) are over. The store already drops
 * resolved rallies, so this is a defensive guard against the brief window before
 * a resolution update lands.
 */
const RALLY_LAST_LIVE_STATUS = 2;

export interface IncomingThreat {
  /** Any credible attacker is bound for you right now. */
  active: boolean;
  /** Lone non-teammates marching on your city (intent unknown, so strength-gated). */
  travelers: number;
  /** Enemy war-bands (rallies) raised against you (intent unambiguous). */
  rallies: number;
  /** Enemy war-bands marching on the castle you hold. */
  castleRallies: number;
}

const NONE: IncomingThreat = { active: false, travelers: 0, rallies: 0, castleRallies: 0 };

/**
 * The Cairn's early warning: credible enemies bound for your gate or your seat.
 *
 * A Legendary charter perk. Lower tiers only feel a blow once it lands; the
 * Legendary holder feels it coming. Three signals, all read from kingdom-wide
 * state the app already holds (no recurring polling; rallies take one boot-time
 * backfill, then ride the WS):
 *
 *  - travelers: a non-teammate whose journey ends at your city, not yet arrived,
 *    read from the WS-seeded `otherPlayers`. A lone traveller's intent is
 *    unknown, so this is floored at your networth — without that floor a weak
 *    passer-by would pin the orb red and the warning would become noise.
 *  - rallies: a war-band targeting you, read from `incomingRallies`, which the
 *    program-wide WS keeps live (see startGameSubscriptions). A rally exists
 *    only to attack, so its intent is unambiguous and it needs no strength floor.
 *  - castleRallies: a war-band marching on a castle you hold — the same live
 *    `incomingRallies` set, routed there once `usePlayerCastle` surfaces the seat.
 */
export function useIncomingThreat(): IncomingThreat {
  const { publicKey } = useWallet();
  const { data: playerData } = usePlayer();
  const { tier, active: subActive } = useSubscriptionStatus();
  const { data: players } = useWorldPlayers();
  const incomingRallies = useAccountStore(
    useShallow((s) => Array.from(s.incomingRallies.values())),
  );
  const upsertIncomingRally = useAccountStore((s) => s.upsertIncomingRally);
  const myCastleStr = useAccountStore((s) => s.myCastlePda);

  const me = playerData?.account ?? null;
  const myPdaStr = playerData?.pubkey?.toBase58() ?? null;
  const isLegendary = subActive && tier === LEGENDARY_TIER;

  // One-time backfill. The WS only delivers rallies that *change* after connect,
  // so a rally already frozen mid-march at load is invisible until it next moves.
  // Fetch the active set exactly once (Legendary only; staleTime Infinity, so
  // never polled) and warm the store — the WS keeps it live from there. The query
  // key dedups this across the hook's several mount points to a single fetch.
  const client = useNovusMundusClient();
  const { data: rallySeed } = useQuery({
    queryKey: ["incoming-rally-seed", myPdaStr],
    queryFn: () => client.fetchActiveRallies({ activeOnly: true }),
    enabled: isLegendary && !!myPdaStr,
    staleTime: Number.POSITIVE_INFINITY,
  });

  useEffect(() => {
    if (!rallySeed) return;
    for (const { pubkey, account } of rallySeed) {
      if (account.status > RALLY_LAST_LIVE_STATUS) continue;
      const target = account.target.toBase58();
      const aimedAtMe =
        (account.targetType === RALLY_TARGET_PLAYER && target === myPdaStr) ||
        (account.targetType === RALLY_TARGET_CASTLE && target === myCastleStr);
      if (aimedAtMe) upsertIncomingRally(pubkey, account);
    }
  }, [rallySeed, myPdaStr, myCastleStr, upsertIncomingRally]);

  return useMemo(() => {
    if (!isLegendary || !me) return NONE;

    const myCity = me.currentCity;
    const myNetworth = me.networth.toNumber();
    const myTeam = isNullPubkey(me.team) ? null : me.team.toBase58();
    const myOwner = publicKey?.toBase58() ?? null;
    const now = Math.floor(Date.now() / 1000);

    let travelers = 0;
    for (const { account: p } of players ?? []) {
      if (p.destinationCity !== myCity) continue; // not headed to your gate
      if (p.arrivalTime.toNumber() <= now) continue; // settled, or already arrived
      if (myOwner && p.owner.toBase58() === myOwner) continue; // that is you
      const theirTeam = isNullPubkey(p.team) ? null : p.team.toBase58();
      if (myTeam && theirTeam === myTeam) continue; // a teammate is no threat
      if (p.networth.toNumber() < myNetworth) continue; // too small to fear
      travelers++;
    }

    // The store only keeps live rallies already matched to you or your castle;
    // the status check guards the brief window before a resolved one is dropped.
    let rallies = 0;
    let castleRallies = 0;
    for (const { account: r } of incomingRallies) {
      if (r.status > RALLY_LAST_LIVE_STATUS) continue;
      if (r.targetType === RALLY_TARGET_CASTLE) castleRallies++;
      else rallies++;
    }

    const active = travelers > 0 || rallies > 0 || castleRallies > 0;
    return active ? { active, travelers, rallies, castleRallies } : NONE;
  }, [isLegendary, me, players, incomingRallies, publicKey]);
}
