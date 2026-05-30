"use client";

// useMapRoutes: every in-flight city-to-city movement to draw as a line on the
// realm map. Three sources, per the agreed scope:
//   - rally marches (ALL teams): rally_city -> target_city while Marching/Combat
//   - other players' INTERCITY travel: current_city -> destination_city
//   - MY reinforcements (sent + received): sender_city -> destination_city
// Your own travel keeps its dedicated animated arc (RealmMap's `travel` prop),
// so it is intentionally excluded here. Reinforcements stay yours-only: there is
// no cheap global index of every player's reinforcements.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  derivePlayerPda,
  isTraveling,
  RallyStatus,
  ReinforcementStatus,
  TravelType,
} from "novus-mundus-sdk";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWorldPlayers } from "@/lib/hooks/world";
import { useTransact } from "@/lib/hooks/useTransact";

export interface RealmRoute {
  id: string;
  fromCityId: number;
  toCityId: number;
  kind: "rally" | "reinforcement" | "travel";
  // true for the local player's own forces (brighter styling), false for others.
  mine: boolean;
}

export function useMapRoutes(): RealmRoute[] {
  const { publicKey } = useWallet();
  const client = useNovusMundusClient();
  const { data: worldPlayers } = useWorldPlayers();
  const transact = useTransact();
  const walletStr = publicKey?.toBase58() ?? "";

  // Every kingdom rally (any team). Refresh on a local action via txEpoch.
  const ralliesQuery = useQuery({
    queryKey: ["map-routes", "rallies", transact.isPending],
    queryFn: () => client.fetchActiveRallies(),
    staleTime: 15_000,
  });

  // My reinforcements (sent + received), to draw their routes.
  const reinforcementsQuery = useQuery({
    queryKey: ["map-routes", "reinforcements", walletStr, transact.isPending],
    enabled: !!publicKey,
    queryFn: async () => {
      if (!publicKey) return [];
      const [myPda] = derivePlayerPda(client.gameEngine, publicKey);
      const [sent, received] = await Promise.all([
        client.fetchReinforcementsSent(myPda),
        client.fetchReinforcementsReceived(myPda),
      ]);
      return [...sent, ...received];
    },
    staleTime: 15_000,
  });

  return useMemo(() => {
    const out: RealmRoute[] = [];

    // Rally marches: gather city -> target city, while heading to the target.
    for (const r of ralliesQuery.data ?? []) {
      const st = r.account.status;
      if (st !== RallyStatus.Marching && st !== RallyStatus.Combat) continue;
      const from = r.account.rallyCity;
      const to = r.account.targetCity;
      if (from == null || to == null || from === to) continue;
      out.push({
        id: `rally:${r.pubkey.toBase58()}`,
        fromCityId: from,
        toCityId: to,
        kind: "rally",
        mine: !!publicKey && r.account.creator.equals(publicKey),
      });
    }

    // Other players' intercity travel: current -> destination. Skip my own (it
    // is the animated `travel` arc) and anyone not on an intercity journey.
    for (const p of worldPlayers ?? []) {
      if (publicKey && p.account.owner.equals(publicKey)) continue;
      if (!isTraveling(p.account)) continue;
      if (p.account.travelType !== TravelType.Intercity) continue;
      const from = p.account.currentCity;
      const to = p.account.destinationCity;
      if (from == null || to == null || from === to) continue;
      out.push({
        id: `travel:${p.pubkey.toBase58()}`,
        fromCityId: from,
        toCityId: to,
        kind: "travel",
        mine: false,
      });
    }

    // My reinforcements in transit: sender city -> destination city.
    for (const rf of reinforcementsQuery.data ?? []) {
      if (rf.account.status !== ReinforcementStatus.Traveling) continue;
      const from = rf.account.senderCity;
      const to = rf.account.destinationCity;
      if (from == null || to == null || from === to) continue;
      out.push({
        id: `reinf:${rf.pubkey.toBase58()}`,
        fromCityId: from,
        toCityId: to,
        kind: "reinforcement",
        mine: true,
      });
    }

    return out;
  }, [ralliesQuery.data, reinforcementsQuery.data, worldPlayers, publicKey]);
}
