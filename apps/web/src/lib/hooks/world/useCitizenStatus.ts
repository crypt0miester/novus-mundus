import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { derivePlayerPda } from "novus-mundus-sdk";

export function useCitizenStatus() {
  const { publicKey, connected } = useWallet();
  const client = useNovusMundusClient();

  const query = useQuery({
    queryKey: ["world", "citizenStatus", publicKey?.toBase58()],
    queryFn: async () => {
      const result = await client.fetchPlayer(publicKey!);
      const [playerPda] = derivePlayerPda(client.gameEngine, publicKey!);
      return {
        player: result.account,
        playerPda: playerPda.toBase58(),
        isCitizen: result.exists && result.account !== null,
      };
    },
    enabled: connected && !!publicKey,
    staleTime: 30_000,
  });

  return {
    connected,
    isCitizen: query.data?.isCitizen ?? false,
    player: query.data?.player ?? null,
    playerPda: query.data?.playerPda ?? null,
    isLoading: query.isLoading,
  };
}
