import { useQuery } from "@tanstack/react-query";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { PublicKey } from "@solana/web3.js";

export function useWorldTeamMembers(teamPda: string | undefined) {
  const client = useNovusMundusClient();
  return useQuery({
    queryKey: ["world", "teamMembers", teamPda],
    queryFn: () => client.fetchTeamMembers(new PublicKey(teamPda!)),
    enabled: !!teamPda,
    staleTime: 30_000,
  });
}
