"use client";

import { useQuery } from "@tanstack/react-query";
import { useConnection } from "@solana/wallet-adapter-react";
import {
  deriveDungeonTemplatePda,
  parseDungeonTemplate,
  type DungeonTemplateAccount,
} from "novus-mundus-sdk";

/** How many dungeon ids to probe for templates. */
const MAX_DUNGEON_PROBE = 12;

export interface DungeonEntry {
  id: number;
  template: DungeonTemplateAccount;
}

/**
 * Every dungeon template that exists on-chain. Dungeon ids are contiguous from
 * 0 with no registry counter, so we probe a fixed range in one batched RPC
 * call and keep whichever resolve. Templates are immutable — cached long.
 */
export function useDungeonTemplates() {
  const { connection } = useConnection();
  return useQuery({
    queryKey: ["dungeonTemplates"],
    queryFn: async (): Promise<DungeonEntry[]> => {
      const ids = Array.from({ length: MAX_DUNGEON_PROBE }, (_, i) => i);
      const pdas = await Promise.all(
        ids.map(async (id) => (await deriveDungeonTemplatePda(id))[0]),
      );
      const infos = await connection.getMultipleAccountsInfo(pdas);
      const out: DungeonEntry[] = [];
      ids.forEach((id, i) => {
        const info = infos[i];
        if (!info) return;
        const template = parseDungeonTemplate(info);
        if (template) out.push({ id, template });
      });
      return out;
    },
    staleTime: 10 * 60_000,
  });
}
