import type { Connection, PublicKey } from "@solana/web3.js";
import type { ExpeditionAccount, NovusMundusClient, RoutedAccount } from "novus-mundus-sdk";
import { tryDeserializeAnyAccount } from "novus-mundus-sdk";
import { useAccountStore } from "./accounts";

// The full zustand state shape (fields + setters). Derived from the store so
// the registry below references its concrete fields/setters by name.
type AccountsState = ReturnType<typeof useAccountStore.getState>;

// The account union the router can yield. The router resolves the concrete
// member at runtime from byte 0; each singleton setter wants one narrow member.
type RoutedAccountData = RoutedAccount["account"];

// Keys whose refetch resolves a singleton account by its current store pubkey
// and pushes it back through the concrete zustand setter.
type RefetchKey =
  | "castle"
  | "team"
  | "rally"
  | "reinforcement"
  | "dungeonRun"
  | "arenaParticipant"
  | "arenaSeason"
  | "arenaLoadout"
  | "researchProgress";

// One registry slot per RefetchKey. Both the entry accessor and the setter are
// referenced BY NAME against AccountsState, so renaming a store field/setter
// becomes a COMPILE error here instead of a silent no-op. `T` ties the entry's
// account type to the setter's, and `apply` confines the router-union →
// concrete-account narrowing to a single typed seam (the router has already
// resolved the right account by byte 0 at runtime).
interface RefetchSlot {
  entry: (s: AccountsState) => { pubkey: PublicKey } | null;
  apply: (s: AccountsState, pubkey: PublicKey, account: RoutedAccountData) => void;
}

function slot<T>(
  entry: (s: AccountsState) => { pubkey: PublicKey; account: T } | null,
  set: (s: AccountsState) => (pubkey: PublicKey, account: T) => void,
): RefetchSlot {
  return {
    entry,
    apply: (s, pubkey, account) => set(s)(pubkey, account as T),
  };
}

const SINGLETON_REGISTRY = {
  castle: slot(
    (s) => s.castle,
    (s) => s.setCastle,
  ),
  team: slot(
    (s) => s.team,
    (s) => s.setTeam,
  ),
  rally: slot(
    (s) => s.rally,
    (s) => s.setRally,
  ),
  reinforcement: slot(
    (s) => s.reinforcement,
    (s) => s.setReinforcement,
  ),
  dungeonRun: slot(
    (s) => s.dungeonRun,
    (s) => s.setDungeonRun,
  ),
  arenaParticipant: slot(
    (s) => s.arenaParticipant,
    (s) => s.setArenaParticipant,
  ),
  arenaSeason: slot(
    (s) => s.arenaSeason,
    (s) => s.setArenaSeason,
  ),
  arenaLoadout: slot(
    (s) => s.arenaLoadout,
    (s) => s.setArenaLoadout,
  ),
  researchProgress: slot(
    (s) => s.researchProgress,
    (s) => s.setResearchProgress,
  ),
} satisfies Record<RefetchKey, RefetchSlot>;

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
          jobs.push(
            refetchByPubkey(conn, entry.pubkey, (account) => {
              store().setExpedition(entry.pubkey, account as ExpeditionAccount);
            }),
          );
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
      // Singleton accounts — refetch by existing pubkey via the typed registry.
      // "research-progress" is the kebab queryKey alias for researchProgress.
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
        const field: RefetchKey = key === "research-progress" ? "researchProgress" : key;
        const slotDef = SINGLETON_REGISTRY[field];
        const entry = slotDef.entry(store());
        if (entry) {
          const pubkey = entry.pubkey;
          jobs.push(
            refetchByPubkey(conn, pubkey, (account) => {
              slotDef.apply(store(), pubkey, account);
            }),
          );
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
  conn: Connection,
  pubkey: PublicKey,
  onSuccess: (account: RoutedAccountData) => void,
): Promise<void> {
  const info = await conn.getAccountInfo(pubkey);
  if (!info) return;
  const routed = tryDeserializeAnyAccount(info.data);
  if (routed) onSuccess(routed.account);
}
