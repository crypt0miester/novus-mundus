import { useQuery } from "@tanstack/react-query";
import { useNovusMundusClient } from "@/lib/solana/provider";

export function useWorldTeam(teamId: number | undefined) {
  const client = useNovusMundusClient();
  return useQuery({
    queryKey: ["world", "team", teamId],
    queryFn: () => client.fetchTeam(teamId!),
    enabled: teamId != null,
    staleTime: 30_000,
  });
}
