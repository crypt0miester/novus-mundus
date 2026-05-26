import { useQuery } from "@tanstack/react-query";
import { useNovusMundusClient } from "@/lib/solana/provider";

/**
 * Every castle in the kingdom, with its on-chain lat/long. Used by the realm
 * map to render castles as spatial entities. CastleAccount stores latitude /
 * longitude as i32 microdegrees (×1,000,000) — divide by 1e6 for float
 * degrees, then ×10,000 for the disc grid (same scale as player.currentLat).
 */
export function useWorldCastles() {
  const client = useNovusMundusClient();
  return useQuery({
    queryKey: ["world", "castles"],
    queryFn: () => client.fetchAllCastles(),
    staleTime: 30_000,
  });
}
