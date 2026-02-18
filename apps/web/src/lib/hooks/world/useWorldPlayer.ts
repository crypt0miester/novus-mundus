import { useQuery } from "@tanstack/react-query";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { PublicKey } from "@solana/web3.js";

export function useWorldPlayer(address: string | undefined) {
  const client = useNovusMundusClient();
  return useQuery({
    queryKey: ["world", "player", address],
    queryFn: () => client.fetchPlayer(new PublicKey(address!)),
    enabled: !!address,
    staleTime: 15_000,
  });
}
