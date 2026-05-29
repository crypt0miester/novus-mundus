import { useQuery } from "@tanstack/react-query";
import { useShallow } from "zustand/react/shallow";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useAccountStore } from "@/lib/store/accounts";

/**
 * All cities in the kingdom.
 *
 * Boot-time `startGameSubscriptions` seeds `cities` for the whole kingdom
 * in a single fetchAllCities, and the program-wide WS keeps it live
 * thereafter — so when the store is populated we read it straight from
 * zustand (live, no extra getProgramAccounts scan), mirroring
 * useCityPlayers. Only the no-wallet spectator case (store empty, no
 * subscription) falls back to an enabled-gated fetch so the world pages
 * still work pre-connect.
 */
export function useWorldCities() {
  const client = useNovusMundusClient();
  // Snapshot the seeded store under useShallow so an unrelated city update
  // doesn't churn this hook's identity for every world-page consumer.
  const storeCities = useAccountStore(useShallow((s) => Array.from(s.cities.values())));
  const hasStore = storeCities.length > 0;

  const query = useQuery({
    queryKey: ["world", "cities"],
    queryFn: () => client.fetchAllCities(),
    staleTime: 60_000,
    // The WS-seeded store is the source of truth once populated; only run
    // the unbounded scan when nothing has seeded it yet.
    enabled: !hasStore,
  });

  if (hasStore) {
    return { ...query, data: storeCities, isLoading: false };
  }
  return query;
}
