import { useQuery } from "@tanstack/react-query";
import { useNovusMundusClient } from "@/lib/solana/provider";

export function useWorldTeams() {
  const client = useNovusMundusClient();
  return useQuery({
    queryKey: ["world", "teams"],
    queryFn: () => client.fetchAllTeams({ activeOnly: true }),
    staleTime: 60_000,
  });
}
