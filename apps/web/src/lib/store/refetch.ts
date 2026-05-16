import type { PublicKey } from "@solana/web3.js";
import type { NovusMundusClient } from "novus-mundus-sdk";
import { tryDeserializeAnyAccount } from "novus-mundus-sdk";
import { useAccountStore } from "./accounts";

/**
 * After a tx confirms, refetch affected accounts via RPC and push to zustand.
 * This is the reliable fallback for when the WS account subscription lags.
 * Runs in parallel with the WS — whichever arrives first wins.
 */
export async function refetchAccounts(
  keys: string[],
  client: NovusMundusClient,
  wallet: PublicKey,
): Promise<void> {
  const store = useAccountStore.getState;
  const conn = client.connection;

  const jobs: Promise<void>[] = [];

  // Deduplicate keys
  const unique = [...new Set(keys)];

  for (const key of unique) {
    switch (key) {
      case "player": {
        jobs.push(
          client.fetchPlayer(wallet).then((r) => {
            if (r.account) store().setPlayer(r.pubkey, r.account);
          }),
        );
        break;
      }
      case "estate": {
        const playerEntry = store().player;
        if (playerEntry) {
          jobs.push(
            client.fetchEstate(playerEntry.pubkey).then((r) => {
              if (r.account) store().setEstate(r.pubkey, r.account);
            }),
          );
        }
        break;
      }
      case "expedition": {
        const entry = store().expedition;
        if (entry) {
          jobs.push(refetchByPubkey(conn, entry.pubkey, (account) => {
            store().setExpedition(entry.pubkey, account);
          }));
        } else {
          const playerEntry = store().player;
          if (playerEntry) {
            jobs.push(
              client.fetchExpedition(playerEntry.pubkey).then((r) => {
                if (r.account) store().setExpedition(r.pubkey, r.account);
              }),
            );
          }
        }
        break;
      }
      // Singleton accounts — refetch by existing pubkey
      case "castle":
      case "team":
      case "rally":
      case "reinforcement":
      case "dungeonRun":
      case "arenaParticipant":
      case "arenaSeason":
      case "arenaLoadout":
      case "researchProgress":
      case "research-progress": {
        const field = key === "research-progress" ? "researchProgress" : key;
        const entry = store()[field as keyof ReturnType<typeof store>] as { pubkey: PublicKey; account: unknown } | null;
        if (entry) {
          jobs.push(refetchByPubkey(conn, entry.pubkey, (account) => {
            const setter = `set${field.charAt(0).toUpperCase()}${field.slice(1)}` as keyof ReturnType<typeof store>;
            const fn = store()[setter] as ((pubkey: PublicKey, account: unknown) => void) | undefined;
            if (fn) fn(entry.pubkey, account);
          }));
        }
        break;
      }
      // Collections and React Query-only keys — skip (WS handles these fine)
      case "encounters":
      case "loot":
      case "cityPlayers":
      case "teamMembers":
      case "owned-domains":
      case "craft":
        break;
    }
  }

  await Promise.allSettled(jobs);
}

async function refetchByPubkey(
  conn: { getAccountInfo: (pubkey: PublicKey) => Promise<{ data: Buffer } | null> },
  pubkey: PublicKey,
  onSuccess: (account: any) => void,
): Promise<void> {
  const info = await conn.getAccountInfo(pubkey);
  if (!info) return;
  const routed = tryDeserializeAnyAccount(info.data);
  if (routed) onSuccess(routed.account);
}
