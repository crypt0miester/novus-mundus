import { useQuery } from "@tanstack/react-query";
import { useShallow } from "zustand/react/shallow";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useAccountStore } from "@/lib/store/accounts";

/**
 * All players in the kingdom.
 *
 * Boot-time `startGameSubscriptions` seeds `otherPlayers` for the whole
 * kingdom in a single fetchAllPlayers, and the program-wide WS keeps it
 * live thereafter — so when the store is populated we read it straight
 * from zustand (live, no extra getProgramAccounts scan), mirroring
 * useCityPlayers. Only the no-wallet spectator case (store empty, no
 * subscription) falls back to an enabled-gated fetch so the world pages
 * still work pre-connect.
 */
export function useWorldPlayers() {
  const client = useNovusMundusClient();
  // Snapshot the seeded store under useShallow so an unrelated player tick
  // doesn't churn this hook's identity for every world-page consumer.
  const storePlayers = useAccountStore(useShallow((s) => Array.from(s.otherPlayers.values())));
  const hasStore = storePlayers.length > 0;

  const query = useQuery({
    queryKey: ["world", "players"],
    queryFn: () => client.fetchAllPlayers(),
    staleTime: 30_000,
    // The WS-seeded store is the source of truth once populated; only run
    // the unbounded scan when nothing has seeded it yet.
    enabled: !hasStore,
  });

  if (hasStore) {
    return { ...query, data: storePlayers, isLoading: false };
  }
  return query;
}
