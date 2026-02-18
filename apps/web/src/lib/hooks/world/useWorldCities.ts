import { useQuery } from "@tanstack/react-query";
import { useNovusMundusClient } from "@/lib/solana/provider";

export function useWorldCities() {
  const client = useNovusMundusClient();
  return useQuery({
    queryKey: ["world", "cities"],
    queryFn: () => client.fetchAllCities(),
    staleTime: 60_000,
  });
}
