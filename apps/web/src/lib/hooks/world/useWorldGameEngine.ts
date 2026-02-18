import { useQuery } from "@tanstack/react-query";
import { useNovusMundusClient } from "@/lib/solana/provider";

export function useWorldGameEngine() {
  const client = useNovusMundusClient();
  return useQuery({
    queryKey: ["world", "gameEngine"],
    queryFn: () => client.fetchGameEngine(),
    staleTime: 60_000,
  });
}
