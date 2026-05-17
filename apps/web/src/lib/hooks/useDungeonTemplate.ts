"use client";

import { useQuery } from "@tanstack/react-query";
import { useConnection } from "@solana/wallet-adapter-react";
import {
  deriveDungeonTemplatePda,
  parseDungeonTemplate,
  type DungeonTemplateAccount,
} from "novus-mundus-sdk";

/**
 * Fetch a DungeonTemplate by id. Templates are DAO-created and immutable, so
 * the result is cached aggressively. The dungeon UI needs the template for the
 * floor count, rooms-per-floor, checkpoints, theme, and reward config — none
 * of which live on the per-run DungeonRun account.
 */
export function useDungeonTemplate(dungeonId: number | null | undefined) {
  const { connection } = useConnection();
  return useQuery({
    queryKey: ["dungeonTemplate", dungeonId],
    queryFn: async (): Promise<DungeonTemplateAccount | null> => {
      const [pda] = deriveDungeonTemplatePda(dungeonId!);
      const info = await connection.getAccountInfo(pda);
      return info ? parseDungeonTemplate(info) : null;
    },
    enabled: dungeonId != null,
    staleTime: 10 * 60_000,
  });
}
