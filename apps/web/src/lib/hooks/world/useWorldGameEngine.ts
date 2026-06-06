import { useQuery } from "@tanstack/react-query";
import { useNovusMundusClient } from "@/lib/solana/provider";

// Wallet-less GameEngine fetch off the RPC. `enabled` defaults to true (the
// always-spectator surfaces like RealmMap need it unconditionally); callers
// that only need it in spectator mode pass `enabled: isSpectator` so a logged-in
// player - who already has the engine in the account store - doesn't pay the
// extra round-trip.
export function useWorldGameEngine(opts?: { enabled?: boolean }) {
  const client = useNovusMundusClient();
  return useQuery({
    queryKey: ["world", "gameEngine"],
    queryFn: () => client.fetchGameEngine(),
    staleTime: 60_000,
    enabled: opts?.enabled ?? true,
  });
}
