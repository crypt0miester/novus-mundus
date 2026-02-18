import { useQuery } from "@tanstack/react-query";
import { useNovusMundusClient } from "@/lib/solana/provider";

export function useWorldPlayers() {
  const client = useNovusMundusClient();
  return useQuery({
    queryKey: ["world", "players"],
    queryFn: () => client.fetchAllPlayers(),
    staleTime: 30_000,
  });
}
